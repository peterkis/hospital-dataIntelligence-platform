export function validCatalogLocalTime(value:unknown):boolean {
 if(typeof value!=='string')return false;
 const parts=/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,6})?$/u.exec(value);
 if(!parts)return false;
 const year=Number(parts[1]),month=Number(parts[2]),day=Number(parts[3]),hour=Number(parts[4]),minute=Number(parts[5]),second=Number(parts[6]);
 if(year<1||month<1||month>12||day<1||hour>23||minute>59||second>59)return false;
 const date=new Date(0);date.setUTCFullYear(year,month-1,day);date.setUTCHours(hour,minute,second,0);
 return date.getUTCFullYear()===year&&date.getUTCMonth()===month-1&&date.getUTCDate()===day;
}
