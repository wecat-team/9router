#!/usr/bin/env python3
"""Cảnh báo lỗi API 9router qua Telegram (WeCat). Cron 5 phút/lần trên mỗi host production.

Nguồn chính là access log của reverse proxy, tức status mà app thật sự nhận được. Chỉ tính đường API
(/v1/...), bỏ bot quét web. Nguyên nhân rút gọn lấy từ log container 9router trong cùng khung giờ.
Tin nhắn không chứa prompt, ảnh, IP, header hay token; email tài khoản được che một phần.

Cấu hình đọc từ file env (KEY=VALUE, quyền 600, không commit), truyền bằng --env (lặp được):
  TG_TOKEN, TG_CHAT      bot Telegram và chat nhận tin
  ALERT_ROLE             primary | secondary (chỉ để hiện trong tin)
  ALERT_SOURCE           nginx:<đường dẫn timing.log> | caddy:<tên container Caddy>
                         (Caddy: status 0 không tính là lỗi, xem parse_caddy; 499 chỉ thấy được qua nginx)
  ALERT_CADDY_HOST       (caddy) chỉ tính request tới host này
  ALERT_CONTAINER        container 9router (đọc nguyên nhân, kiểm còn chạy)
  ALERT_STATE            thư mục state (mặc định /var/lib/wecat-alert)
  ALERT_DRY_RUN=1        in tin ra stdout thay vì gửi
Thử offline: python3 alert.py --self-test
"""
import collections
import datetime as dt
import fcntl
import json
import os
import re
import subprocess
import sys
import time
import urllib.parse
import urllib.request

WINDOW = 300                # khung đếm 5 phút, khớp cron
COOLDOWN = 1800             # trong 30 phút sau một tin, lỗi mới được gộp vào tin kế tiếp
RECOVER_WINDOWS = 3         # 15 phút sạch lỗi thì báo "ổn lại"
REAUTH_COOLDOWN = 6 * 3600  # nhắc lại tài khoản cần đăng nhập lại sau 6 giờ
MAX_CATCHUP = 3600          # cron trễ/máy khởi động lại: đọc bù tối đa 1 giờ
MIN_499 = 3                 # 499 (app tự ngắt) lẻ tẻ có thể là người dùng hủy; từ 3 lần/khung mới báo
VN = dt.timezone(dt.timedelta(hours=7))

API_PATH = re.compile(
    r'^/v1/(chat/completions|completions|responses(/[\w.-]+)*|messages(/[\w.-]+)?|embeddings'
    r'|images/(generations|edits)|audio/[\w/.-]+|models(/[\w./:-]+)?)/?$')
NGINX_LINE = re.compile(r'^\S+ \[([^\]]+)\] "(\S+) (\S+)[^"]*" (\d{3}) ')
EMAIL = re.compile(r'[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}')
REAUTH_SIGNAL = re.compile(r'invalidated oauth token|refresh_token_invalidated|Re-auth required', re.I)
REAUTH_ACCOUNT = re.compile(r'\[AUTH\] (\S+@\S+) locked \S+ for \d+s \[401\]')
STATUS_NOTE = {'499': 'app tự ngắt', '502': 'upstream lỗi', '503': 'không còn tài khoản', '504': 'quá thời gian',
               '429': 'hết quota/rate limit', '404': 'không có model/đường', '401': 'sai API key', '400': 'request sai'}


def mask_email(e):
    user, _, domain = e.partition('@')
    return f'{user[:3]}***@{domain}'


def api_path(uri):
    path = uri.split('?', 1)[0]
    return path if API_PATH.match(path) else None


def parse_nginx(lines, start, end):
    """timing.log: `$remote_addr [$time_local] "$request" $status ...` → [(status, method, path)]."""
    out = []
    for line in lines:
        m = NGINX_LINE.match(line)
        if not m:
            continue
        path = api_path(m.group(3))
        if not path:
            continue
        try:
            ts = dt.datetime.strptime(m.group(1), '%d/%b/%Y:%H:%M:%S %z').timestamp()
        except ValueError:
            continue
        if start <= ts < end:
            out.append((m.group(4), m.group(2), path))
    return out


def parse_caddy(lines, host=None):
    """Log access JSON của Caddy (đã lọc khung giờ bằng docker logs). Status 0 = client ngắt → 499."""
    out = []
    for line in lines:
        if '"handled request"' not in line:
            continue
        try:
            rec = json.loads(line)
        except ValueError:
            continue
        req = rec.get('request') or {}
        if host and req.get('host') != host:
            continue
        path = api_path(req.get('uri') or '')
        if path:
            # Status 0 (size 0): Caddy không thấy header trả về qua lớp gate, dù 9router đã trả 200
            # (kiểm 09/11: 104 ảnh thành công đều ghi 0). Không coi là lỗi, chỉ tính vào tổng.
            status = int(rec.get('status') or 0)
            out.append((str(status).zfill(3), req.get('method') or '?', path))
    return out


def error_counts(events):
    # 401 GET /v1/models không kèm key là phép thử của rollout/health check, không phải app gọi sai.
    c = collections.Counter(f'{s} {m} {p}' for s, m, p in events
                            if int(s) >= 400 and not (s == '401' and m == 'GET' and p.startswith('/v1/models')))
    return c, len(events)


def triggered(counts):
    n499 = sum(v for k, v in counts.items() if k.startswith('499 '))
    return any(not k.startswith('499 ') for k in counts) or n499 >= MIN_499


def reasons(lines):
    """Gom dòng lỗi của 9router thành dạng chung (bỏ giờ, che email, bỏ số giây) để đếm."""
    c = collections.Counter()
    for line in lines:
        if not ('❌' in line or 'accounts locked' in line):
            continue
        s = re.sub(r'^\[\d{2}:\d{2}:\d{2}\]\s*', '', line.strip())
        s = EMAIL.sub('<tài khoản>', s)
        s = re.sub(r'\b\d+(ms|s)\b', 'N\\1', s)
        s = re.sub(r'\s+', ' ', s).strip(' {')
        if s and s not in ('❌', '[401]:', '[502]:'):
            c[s[:140]] += 1
    return c


def reauth_accounts(lines):
    if not any(REAUTH_SIGNAL.search(l) for l in lines):
        return set()
    accs = {mask_email(m.group(1)) for l in lines for m in [REAUTH_ACCOUNT.search(l)] if m}
    return accs or {'(không rõ tài khoản)'}


def fmt_range(start, end):
    a, b = dt.datetime.fromtimestamp(start, VN), dt.datetime.fromtimestamp(end, VN)
    day = '' if a.date() == dt.datetime.now(VN).date() else a.strftime(' %d/%m')
    return f'{a:%H:%M}–{b:%H:%M}{day}'


def counts_text(counts, limit=8):
    rows = []
    for key, n in counts.most_common(limit):
        status = key.split(' ', 1)[0]
        note = STATUS_NOTE.get(status)
        rows.append(f'• {key} ×{n}' + (f' ({note})' if note else ''))
    if len(counts) > limit:
        rows.append(f'• … và {len(counts) - limit} loại khác')
    return '\n'.join(rows)


def alert_text(role, start, end, counts, total, why):
    n = sum(counts.values())
    lines = [f'⚠️ 9router {role}: {n} lỗi API, {fmt_range(start, end)} (giờ VN)',
             counts_text(counts), f'Tổng request API trong khung: {total}']
    if why:
        lines.append('Log 9router (gồm cả lỗi đã tự chuyển tài khoản thành công):')
        lines += [f'• {k} ×{v}' for k, v in why.most_common(4)]
    lines.append('Lỗi tiếp theo trong 30 phút gộp vào tin sau.')
    return '\n'.join(lines)


def step(state, start, now_end, counts, total, why, role):
    """Máy trạng thái gộp/tắt tiếng. Trả về danh sách tin cần gửi; cập nhật state tại chỗ."""
    msgs = []
    p = state.setdefault('pending', {'start': None, 'counts': {}, 'total': 0, 'why': {}})
    if counts:
        p['start'] = p['start'] or start
        pc = collections.Counter(p['counts']); pc.update(counts); p['counts'] = dict(pc)
        pw = collections.Counter(p['why']); pw.update(why); p['why'] = dict(pw)
    p['total'] += total
    hit = triggered(counts)
    if hit:
        state['clean'] = 0
    if hit or (state.get('alerting') and p['counts']):
        if now_end - state.get('last_alert', 0) >= COOLDOWN and triggered(collections.Counter(p['counts'])):
            msgs.append(alert_text(role, p['start'], now_end, collections.Counter(p['counts']), p['total'],
                                   collections.Counter(p['why'])))
            state.update(alerting=True, last_alert=now_end, clean=0)
            state['pending'] = {'start': None, 'counts': {}, 'total': 0, 'why': {}}
    if not hit and state.get('alerting'):
        state['clean'] = state.get('clean', 0) + 1
        if state['clean'] >= RECOVER_WINDOWS:
            extra = sum(state['pending']['counts'].values())
            tail = f'\nTừ tin trước có thêm {extra} lỗi lẻ:\n{counts_text(collections.Counter(state["pending"]["counts"]))}' if extra else ''
            msgs.append(f'✅ 9router {role}: 15 phút qua không còn lỗi API (tới {fmt_range(now_end - 900, now_end)}).{tail}')
            state.update(alerting=False, clean=0)
            state['pending'] = {'start': None, 'counts': {}, 'total': 0, 'why': {}}
    if not state.get('alerting') and not hit:
        # Lỗi dưới ngưỡng (vd. 1–2 lần 499) không giữ lại khi không ở trạng thái báo động.
        state['pending'] = {'start': None, 'counts': {}, 'total': 0, 'why': {}}
    return msgs


def reauth_step(state, now, accounts, role):
    seen = state.setdefault('reauth', {})
    fresh = sorted(a for a in accounts if now - seen.get(a, 0) >= REAUTH_COOLDOWN)
    for a in fresh:
        seen[a] = now
    if not fresh:
        return []
    return [f'🔑 9router {role}: tài khoản Codex cần đăng nhập lại (OAuth token bị vô hiệu): '
            f'{", ".join(fresh)}. Request đang tự chuyển sang tài khoản khác; vào dashboard › Providers để đăng nhập lại.']


def container_step(state, now, info, rollout_running, role):
    """info = (status, restartCount) hoặc None nếu không tìm thấy container."""
    msgs, prev = [], state.get('container')
    if rollout_running:
        state['container'] = list(info) if info else None
        return msgs
    status, restarts = info if info else ('không tìm thấy', 0)
    if status != 'running' and now - state.get('container_alert', 0) >= COOLDOWN:
        msgs.append(f'🛑 9router {role}: container không chạy (trạng thái: {status}). App sẽ nhận lỗi cho tới khi khôi phục.')
        state['container_alert'] = now
    elif prev and status == 'running' and prev[0] == 'running' and restarts > prev[1]:
        msgs.append(f'♻️ 9router {role}: container vừa tự restart (lần thứ {restarts}). Kiểm log nếu lặp lại.')
    state['container'] = [status, restarts]
    return msgs


# ---------- I/O trên host ----------

def load_env(paths):
    env = {}
    for path in paths:
        with open(path, encoding='utf-8') as f:
            for line in f:
                line = line.strip()
                if line and not line.startswith('#') and '=' in line:
                    k, v = line.split('=', 1)
                    env[k.strip()] = v.strip().strip('"\'')
    return env


def run(cmd):
    try:
        r = subprocess.run(cmd, capture_output=True, text=True, timeout=60)
        return (r.stdout + r.stderr).splitlines()
    except (OSError, subprocess.TimeoutExpired):
        return []


def read_access(source, start, end, caddy_host):
    kind, _, target = source.partition(':')
    if kind == 'nginx':
        lines = []
        for path in (target + '.1', target):  # file vừa rotate vẫn có thể chứa đầu khung
            try:
                if os.path.getmtime(path) >= start:
                    with open(path, encoding='utf-8', errors='replace') as f:
                        lines += f.readlines()
            except OSError:
                pass
        return parse_nginx(lines, start, end)
    if kind == 'caddy':
        return parse_caddy(run(['docker', 'logs', '--since', str(int(start)), '--until', str(int(end)), target]), caddy_host)
    raise SystemExit(f'ALERT_SOURCE không hợp lệ: {source}')


def send(env, text):
    if env.get('ALERT_DRY_RUN') == '1':
        print('--- DRY RUN ---\n' + text)
        return True
    data = urllib.parse.urlencode({'chat_id': env['TG_CHAT'], 'text': text}).encode()
    try:
        with urllib.request.urlopen(f'https://api.telegram.org/bot{env["TG_TOKEN"]}/sendMessage', data, timeout=20) as r:
            return r.status == 200
    except Exception as e:  # không in URL vì có token
        print(f'{time.strftime("%F %T")} gửi Telegram lỗi: {type(e).__name__}', file=sys.stderr)
        return False


def main(argv):
    if '--self-test' in argv:
        return self_test()
    envs = [argv[i + 1] for i, a in enumerate(argv) if a == '--env' and i + 1 < len(argv)]
    env = {**os.environ, **load_env(envs)}
    for k in ('TG_TOKEN', 'TG_CHAT', 'ALERT_SOURCE', 'ALERT_CONTAINER'):
        if not env.get(k):
            raise SystemExit(f'thiếu {k}')
    role = env.get('ALERT_ROLE', '?')
    state_dir = env.get('ALERT_STATE', '/var/lib/wecat-alert')
    os.makedirs(state_dir, mode=0o700, exist_ok=True)
    lock = open(os.path.join(state_dir, 'lock'), 'w')
    try:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
    except OSError:
        return 0  # lượt trước chưa xong
    state_path = os.path.join(state_dir, 'state.json')
    try:
        with open(state_path, encoding='utf-8') as f:
            state = json.load(f)
    except (OSError, ValueError):
        state = {}

    now = time.time()
    end = int(now // WINDOW * WINDOW)
    last = state.get('last_end')
    if last and last >= end:
        return 0
    start = last if last and end - MAX_CATCHUP <= last < end else end - WINDOW
    container = env['ALERT_CONTAINER']

    events = read_access(env['ALERT_SOURCE'], start, end, env.get('ALERT_CADDY_HOST'))
    counts, total = error_counts(events)
    logs = run(['docker', 'logs', '--since', str(int(start)), '--until', str(int(end)), container])
    why = reasons(logs) if counts else collections.Counter()
    info = run(['docker', 'inspect', '-f', '{{.State.Status}} {{.RestartCount}}', container])
    parts = info[0].split() if info else []
    cinfo = (parts[0], int(parts[1])) if len(parts) == 2 and parts[1].isdigit() else None
    rollout = bool(run(['pgrep', '-f', 'operator-rollout.py']))

    msgs = step(state, start, end, counts, total, why, role)
    msgs += reauth_step(state, end, reauth_accounts(logs), role)
    msgs += container_step(state, end, cinfo, rollout, role)
    sent_all = all(send(env, m) for m in msgs)
    if not sent_all and msgs:
        return 1  # không lưu state: lượt sau đọc bù khung này và gửi lại
    state['last_end'] = end
    tmp = state_path + '.tmp'
    with open(tmp, 'w', encoding='utf-8') as f:
        json.dump(state, f)
    os.replace(tmp, state_path)
    if msgs:
        print(f'{time.strftime("%F %T")} đã gửi {len(msgs)} tin')
    return 0


# ---------- self-test (không mạng, không docker) ----------

def self_test():
    t0 = dt.datetime(2026, 11, 9, 10, 20, tzinfo=VN).timestamp()
    ng = [
        '203.0.113.5 [09/Nov/2026:10:21:00 +0700] "POST /v1/images/generations?response_format=binary HTTP/1.1" 502 120 rt=30.1 urt=30.0',
        '203.0.113.5 [09/Nov/2026:10:21:05 +0700] "POST /v1/chat/completions HTTP/1.1" 200 1476 rt=1 urt=1',
        '198.51.100.9 [09/Nov/2026:10:22:00 +0700] "GET /v1/.env HTTP/1.1" 401 0 rt=0 urt=0',
        '198.51.100.9 [09/Nov/2026:10:22:01 +0700] "POST /wp-login.php HTTP/1.1" 404 0 rt=0 urt=0',
        '203.0.113.5 [09/Nov/2026:10:25:00 +0700] "POST /v1/chat/completions HTTP/1.1" 404 10 rt=0 urt=0',
    ]
    ev = parse_nginx(ng, t0, t0 + WINDOW)
    assert ev == [('502', 'POST', '/v1/images/generations'), ('200', 'POST', '/v1/chat/completions')], ev
    cd = [json.dumps({'msg': 'handled request', 'status': s, 'request': {'host': h, 'method': 'POST', 'uri': u}})
          for s, h, u in [(502, 'r.example', '/v1/images/generations?x=1'), (0, 'r.example', '/v1/chat/completions'),
                          (500, 'other.example', '/v1/chat/completions'), (404, 'r.example', '/admin')]]
    ce = parse_caddy(cd, 'r.example')
    assert ce == [('502', 'POST', '/v1/images/generations'), ('000', 'POST', '/v1/chat/completions')], ce
    assert error_counts([('401', 'GET', '/v1/models')])[0] == collections.Counter()
    assert error_counts(ce) == (collections.Counter({'502 POST /v1/images/generations': 1}), 2)

    logs = ['[03:21:51] ⚠️  [AUTH] codex | all 6 accounts locked for gpt-6-sol-image (reset after 25s) | lastError=[502]: fetch failed',
            '❌ codex [502]: [502]: fetch failed (cause: ETIMEDOUT)', '❌ codex [502]: [502]: fetch failed (cause: ETIMEDOUT)',
            '[04:53:46] ⚠️  [AUTH] someone.long@example.com locked modelLock_gpt-6-luna for 120s [401]',
            '❌ codex [401]: [401]: Encountered invalidated oauth token for user, failing request']
    why = reasons(logs)
    assert why['❌ codex [502]: [502]: fetch failed (cause: ETIMEDOUT)'] == 2, why
    assert not any('@' in k for k in why)
    assert reauth_accounts(logs) == {'som***@example.com'}

    st, role = {}, 'primary'
    c, n = error_counts(ev)
    m = step(st, t0, t0 + WINDOW, c, n, why, role)
    assert len(m) == 1 and '502 POST /v1/images/generations ×1' in m[0] and '203.0.113' not in m[0], m
    assert '10:20–10:25' in m[0], m  # nhãn giờ theo khung thật (cả khi đọc bù)
    m = step(st, t0 + 2 * WINDOW - WINDOW, t0 + 2 * WINDOW, collections.Counter({'502 POST /v1/images/generations': 4}), 10, why, role)
    assert m == [] and st['pending']['counts']['502 POST /v1/images/generations'] == 4  # đang tắt tiếng: gộp
    for i in range(3, 6):
        m = step(st, t0 + i * WINDOW - WINDOW, t0 + i * WINDOW, collections.Counter(), 5, collections.Counter(), role)
    assert len(m) == 1 and m[0].startswith('✅') and 'thêm 4 lỗi' in m[0] and not st['alerting'], m
    m = step(st, t0 + 6 * WINDOW - WINDOW, t0 + 6 * WINDOW, collections.Counter({'499 POST /v1/images/generations': 2}), 5, why, role)
    assert m == []  # 499 dưới ngưỡng
    m = step(st, t0 + 7 * WINDOW + COOLDOWN - WINDOW, t0 + 7 * WINDOW + COOLDOWN, collections.Counter({'499 POST /v1/images/generations': 3}), 5, why, role)
    assert len(m) == 1 and 'app tự ngắt' in m[0]

    st = {}
    assert len(reauth_step(st, t0, {'abc***@x.com'}, role)) == 1
    assert reauth_step(st, t0 + 60, {'abc***@x.com'}, role) == []
    assert len(reauth_step(st, t0 + REAUTH_COOLDOWN, {'abc***@x.com'}, role)) == 1

    st = {}
    assert container_step(st, t0, ('running', 0), False, role) == []
    assert 'restart' in container_step(st, t0 + 300, ('running', 1), False, role)[0]
    assert container_step(st, t0 + 600, ('exited', 1), True, role) == []  # đang rollout: im lặng
    assert 'không chạy' in container_step(st, t0 + 900, ('exited', 1), False, role)[0]
    print('alert self-test ok')
    return 0


if __name__ == '__main__':
    sys.exit(main(sys.argv[1:]))
