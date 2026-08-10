import sharp from 'sharp';
import { readFileSync } from 'node:fs';
import { detectCard, rectifyCard, encodeRaw } from './src/lib/image/rectify';
import { CARD_ASPECT, REGIONS, regionToPixels } from './src/lib/card-geometry';

async function main() {
  const photo = readFileSync('/tmp/photo.jpg');
  const det = await detectCard(photo);
  console.log('corners:', det.corners.map(c => `(${Math.round(c.x)},${Math.round(c.y)})`).join(' '));
  console.log('aspect:', det.measuredAspect.toFixed(4), 'vs', CARD_ASPECT.toFixed(4),
              `(${((det.measuredAspect-CARD_ASPECT)/CARD_ASPECT*100).toFixed(1)}%)`,
              'conf', det.confidence.toFixed(2));
  const [tl,tr,br,bl]=det.corners;
  const d=(a:any,b:any)=>Math.hypot(a.x-b.x,a.y-b.y);
  console.log('edges: top',d(tl,tr).toFixed(0),'bottom',d(bl,br).toFixed(0),'left',d(tl,bl).toFixed(0),'right',d(tr,br).toFixed(0));

  const rect = await rectifyCard(photo, det.corners);
  await sharp(await encodeRaw(rect,'jpeg')).toFile('/tmp/shots/rectified.jpg');
  // crop the name region so we can see what OCR is reading
  const r = regionToPixels(REGIONS.nameBar, { width: rect.width, height: rect.height });
  await sharp(await encodeRaw(rect,'png')).extract({left:r.x,top:r.y,width:r.width,height:r.height})
    .resize({width:r.width*2}).toFile('/tmp/shots/namebar.png');
  console.log('wrote /tmp/shots/rectified.jpg and namebar.png');
}
main().catch(e=>{console.error(e);process.exit(1)});
