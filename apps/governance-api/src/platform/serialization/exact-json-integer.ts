/** Read the mathematical integer before JSON decoding can round its token. */
export function parseExactSafeInteger(token:string):number|null {
 if(token.length>8192)return null;
 const parts=/^(-?)(0|[1-9][0-9]*)(?:\.([0-9]+))?(?:[eE]([+-]?[0-9]+))?$/u.exec(token);
 if(!parts)return null;
 let digits=(parts[2]!+(parts[3]??'')).replace(/^0+/u,'');
 if(!digits)return parts[1]==='-'?-0:0;
 const power=BigInt(parts[4]??'0')-BigInt(parts[3]?.length??0);
 if(power>=0n){
  if(power>16n||BigInt(digits.length)+power>16n)return null;
  digits+='0'.repeat(Number(power));
 }else{
  const places=-power;if(places>=BigInt(digits.length))return null;
  const cut=digits.length-Number(places);
  if(!/^0+$/u.test(digits.slice(cut)))return null;
  digits=digits.slice(0,cut);
 }
 const value=BigInt(digits);if(value>BigInt(Number.MAX_SAFE_INTEGER))return null;
 return Number(parts[1]==='-'?-value:value);
}
