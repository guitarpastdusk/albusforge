#include "hsx-wire.h"
#include "hsx-profile.h"
#include <ctype.h>
#include <math.h>
#include <stdio.h>
#include <string.h>
int hsx_encode_packet(char *output,size_t capacity,const char *device,uint64_t sequence,int64_t timestamp,float lux,uint64_t uptime) {
  if(!device||strlen(device)!=36||sequence>9007199254740991ULL||timestamp<=0||timestamp>253402300799LL||uptime>9007199254740991ULL||!isfinite(lux)||lux<0||lux>65535)return -1;
  for(int i=0;i<36;i++)if((i==8||i==13||i==18||i==23)?device[i]!='-':!isxdigit((unsigned char)device[i]))return -1;
  int size=snprintf(output,capacity,"{\"v\":1,\"dev\":\"%s\",\"seq\":%llu,\"ts\":%lld,\"r\":[{\"c\":\"" HSX_CHANNEL "\",\"t\":%lld,\"v\":%.6g}],\"st\":{\"up_s\":%llu,\"health\":[]}}",device,(unsigned long long)sequence,(long long)timestamp,(long long)timestamp,(double)lux,(unsigned long long)uptime);
  return size<0||(size_t)size>=capacity?-1:size;
}
