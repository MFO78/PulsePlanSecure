import fs from 'node:fs';
import zlib from 'node:zlib';

const points = [[6.5,20.5],[13,20.5],[16.2,13.5],[20.4,26.5],[23.8,17.5],[26.5,20.5],[33.5,20.5]];
function distance(x,y,a,b) {
  const dx=b[0]-a[0], dy=b[1]-a[1];
  const t=Math.max(0,Math.min(1,((x-a[0])*dx+(y-a[1])*dy)/(dx*dx+dy*dy)));
  return Math.hypot(x-a[0]-t*dx,y-a[1]-t*dy);
}
function bar(x,y,left,top,width,height) {
  const r=height/2;
  return Math.hypot(x-Math.max(left+r,Math.min(left+width-r,x)),y-(top+r))<=r;
}
function blend(a,b,t) { return a.map((v,i)=>v*(1-t)+b[i]*t); }
function pixel(x,y,scale) {
  const t=Math.max(0,Math.min(1,(x+y-4)/72));
  let rgb=t<0.55 ? blend([6,95,70],[5,150,105],t/0.55) : blend([5,150,105],[13,148,136],(t-0.55)/0.45);
  const u=20+(x-20)/scale, v=20+(y-20)/scale;
  if (bar(u,v,7,9,14,3.5)||bar(u,v,18,27.5,15,3.5)) rgb=blend(rgb,[255,255,255],0.38);
  if (bar(u,v,23,9,10,3.5)||bar(u,v,7,27.5,9,3.5)) rgb=blend(rgb,[167,243,208],0.55);
  if (points.slice(1).some((p,i)=>distance(u,v,points[i],p)<=1.5)) rgb=[255,255,255];
  if (Math.hypot(u-33.5,v-20.5)<=2.4) rgb=[52,211,153];
  return rgb;
}
function chunk(type,data) {
  const payload=Buffer.concat([Buffer.from(type),data]);
  let c=0xffffffff;
  for (const byte of payload) {
    c^=byte;
    for(let k=0;k<8;k++) c=(c>>>1)^(0xedb88320&-(c&1));
  }
  const out=Buffer.alloc(data.length+12);
  out.writeUInt32BE(data.length,0);
  payload.copy(out,4);
  out.writeUInt32BE((c^0xffffffff)>>>0,out.length-4);
  return out;
}
function render(size,scale,rounded=false) {
  const stride=size*4+1, raw=Buffer.alloc(stride*size);
  for(let y=0;y<size;y++) for(let x=0;x<size;x++) {
    const rgb=[0,0,0];
    let coverage=0;
    for(const oy of [0.25,0.75]) for(const ox of [0.25,0.75]) {
      const px=(x+ox)*40/size, py=(y+oy)*40/size;
      if (rounded && Math.hypot(px-Math.max(11,Math.min(29,px)),py-Math.max(11,Math.min(29,py)))>10) continue;
      const sample=pixel(px,py,scale);
      coverage++;
      for(let c=0;c<3;c++) rgb[c]+=sample[c];
    }
    const p=y*stride+1+x*4;
    for(let c=0;c<3;c++) raw[p+c]=coverage ? Math.round(rgb[c]/coverage) : 0;
    raw[p+3]=Math.round(255*coverage/4);
  }
  const header=Buffer.alloc(13);
  header.writeUInt32BE(size,0);
  header.writeUInt32BE(size,4);
  header[8]=8; header[9]=6;
  return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',header),chunk('IDAT',zlib.deflateSync(raw)),chunk('IEND',Buffer.alloc(0))]);
}
fs.writeFileSync('icon-192.png',render(192,1,true));
fs.writeFileSync('icon-512.png',render(512,1,true));
fs.writeFileSync('icon-maskable-512.png',render(512,0.92));
console.log('Rendered rounded standard PNGs and full-bleed maskable PNG with green artwork.');
