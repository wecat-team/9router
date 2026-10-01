import zlib from 'node:zlib';
export function crc32(buffer) {
 let value=0xffffffff;
 for(const byte of buffer){value^=byte;for(let n=0;n<8;n++)value=(value>>>1)^((value&1)?0xedb88320:0);}
 return (value^0xffffffff)>>>0;
}
function chunk(type,data){const name=Buffer.from(type),length=Buffer.alloc(4),crc=Buffer.alloc(4);length.writeUInt32BE(data.length);crc.writeUInt32BE(crc32(Buffer.concat([name,data])));return Buffer.concat([length,name,data,crc]);}
export function referencePng(){
 const width=128,height=128,ihdr=Buffer.alloc(13);ihdr.writeUInt32BE(width,0);ihdr.writeUInt32BE(height,4);ihdr[8]=8;ihdr[9]=2;
 const raw=Buffer.alloc(height*(1+width*3),255);
 for(let y=0;y<height;y++){const start=y*(1+width*3);raw[start]=0;for(let x=0;x<width;x++)if((x-64)**2+(y-64)**2<24**2){const p=start+1+x*3;raw[p]=0;raw[p+1]=80;raw[p+2]=255;}}
 return Buffer.concat([Buffer.from('89504e470d0a1a0a','hex'),chunk('IHDR',ihdr),chunk('IDAT',zlib.deflateSync(raw)),chunk('IEND',Buffer.alloc(0))]);
}
export function verifyPng(bytes){
 if(!Buffer.isBuffer(bytes)||bytes.length<50||bytes.subarray(0,8).toString('hex')!=='89504e470d0a1a0a')throw Error('PNG signature không hợp lệ');
 let offset=8,header,ended=false;const compressed=[];
 while(offset<bytes.length){if(offset+12>bytes.length)throw Error('PNG chunk bị cắt');const n=bytes.readUInt32BE(offset);if(n>bytes.length-offset-12)throw Error('PNG chunk vượt kích thước');const type=bytes.toString('ascii',offset+4,offset+8),data=bytes.subarray(offset+8,offset+8+n);if(crc32(bytes.subarray(offset+4,offset+8+n))!==bytes.readUInt32BE(offset+8+n))throw Error('PNG CRC không hợp lệ');if(type==='IHDR')header=data;if(type==='IDAT')compressed.push(data);offset+=12+n;if(type==='IEND'){ended=true;break;}}
 if(!header||header.length!==13||!ended||offset!==bytes.length||compressed.length===0)throw Error('PNG thiếu cấu trúc bắt buộc');
 zlib.inflateSync(Buffer.concat(compressed),{maxOutputLength:32*1024*1024});return {width:header.readUInt32BE(0),height:header.readUInt32BE(4)};
}
