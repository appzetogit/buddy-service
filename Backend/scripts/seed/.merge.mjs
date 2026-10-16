import fs from 'node:fs';
const BAD=['Moisturizer Cream','Toast Rusk','Milk Rusk','Burger Buns','Nachos','Popcorn','Aloo Bhujia','Hand Wash','Shaving Foam','Sanitary Pads','Baby Oil','Packaged Drinking Water','Coconut Water','Sugar (1 kg)','Almond Hair Oil','Pav Bread','Cream Biscuits','Baby Diaper Pants','Namkeen Mixture'];
const L=(f)=>JSON.parse(fs.readFileSync('.cache/'+f,'utf8'));
const out={sellers:{}};
for(const src of [L('qc-plan2-off.json'),L('qc-plan2-gen.json'),L('qc-plan2-fb.json')]) for(const [k,v] of Object.entries(src.sellers)){
  const o=out.sellers[k]||={shop:null,products:{}};o.shop=o.shop||v.shop;
  for(const [id,p] of Object.entries(v.products)){ if(!o.products[id] && !(p.title.startsWith('File:')&&BAD.some(b=>p.name.startsWith(b)))) o.products[id]=p; }
}
fs.writeFileSync('.cache/qc-plan2.json',JSON.stringify(out,null,1));
for(const [k,v] of Object.entries(out.sellers)) console.log(Object.keys(v.products).length,v.shop?'shop':'NOSHOP',k);
