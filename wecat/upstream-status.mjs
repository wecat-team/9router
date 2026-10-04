// Chỉ đọc: so bản upstream WeCat đã chấp nhận với tag phát hành mới nhất của decolua/9router.
// Dùng: node wecat/upstream-status.mjs [vX.Y.Z|master] [--json]
import { upstreamState, formatReport } from './upstream.mjs';

const args = process.argv.slice(2);
const state = upstreamState(args.find(a => !a.startsWith('--')));
if (args.includes('--json')) {
  console.log(JSON.stringify({ ...state, report: state.upToDate ? null : formatReport(state) }, null, 2));
} else if (state.upToDate) {
  console.log(`Đã cập nhật: fork gồm upstream ${state.ref} (${state.toVersion}).`);
} else {
  console.log(formatReport(state));
  console.log('Nâng bằng: node wecat/prepare-upstream.mjs ' + state.ref + ' --pr');
}
