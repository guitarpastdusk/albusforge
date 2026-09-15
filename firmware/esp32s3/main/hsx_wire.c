#include "hsx-wire.h"
#include "hsx-profile.h"
#include <ctype.h>
#include <limits.h>
#include <math.h>
#include <stdio.h>
#include <string.h>
/* Channel keys must satisfy packages/schema TelemetryChannels: ^[a-z][a-z0-9_]{0,63}$.
 * Anything else would be refused by ingest after the device had already burned a sequence. */
static int valid_channel(const char *channel) {
  if(!channel)return 0;
  size_t length=strlen(channel);
  if(length==0||length>64||channel[0]<'a'||channel[0]>'z')return 0;
  for(size_t i=1;i<length;i++) {
    char c=channel[i];
    if(!((c>='a'&&c<='z')||(c>='0'&&c<='9')||c=='_'))return 0;
  }
  return 1;
}
#define EMIT(...) do { \
  int written=snprintf(output+used,capacity-used,__VA_ARGS__); \
  if(written<0||(size_t)written>=capacity-used)return -1; \
  used+=(size_t)written; \
} while(0)
int hsx_encode_readings(char *output,size_t capacity,const char *device,uint64_t sequence,int64_t timestamp,const hsx_reading_t *readings,size_t count,uint64_t uptime) {
  if(!output||capacity==0||capacity>(size_t)INT_MAX||!device||strlen(device)!=36||sequence>9007199254740991ULL||timestamp<=0||timestamp>253402300799LL||uptime>9007199254740991ULL||!readings||count==0||count>HSX_MAX_READINGS)return -1;
  for(int i=0;i<36;i++)if((i==8||i==13||i==18||i==23)?device[i]!='-':!isxdigit((unsigned char)device[i]))return -1;
  for(size_t i=0;i<count;i++) {
    const hsx_reading_t *reading=&readings[i];
    if(!valid_channel(reading->channel)||!isfinite(reading->value)||!isfinite(reading->min)||!isfinite(reading->max)
      ||reading->min>reading->max||reading->value<reading->min||reading->value>reading->max)return -1;
    for(size_t j=0;j<i;j++)if(strcmp(readings[j].channel,reading->channel)==0)return -1;
  }
  size_t used=0;
  EMIT("{\"v\":1,\"dev\":\"%s\",\"seq\":%llu,\"ts\":%lld,\"r\":[",device,(unsigned long long)sequence,(long long)timestamp);
  for(size_t i=0;i<count;i++)
    EMIT("%s{\"c\":\"%s\",\"t\":%lld,\"v\":%.6g}",i?",":"",readings[i].channel,(long long)timestamp,(double)readings[i].value);
  EMIT("],\"st\":{\"up_s\":%llu,\"health\":[",(unsigned long long)uptime);
  /* A stubbed driver is never allowed to look like a measurement. */
  size_t flagged=0;
  for(size_t i=0;i<count;i++)
    if(readings[i].synthetic) {EMIT("%s\"synthetic:%s\"",flagged?",":"",readings[i].channel);flagged++;}
  EMIT("]}}");
  return (int)used;
}
int hsx_encode_packet(char *output,size_t capacity,const char *device,uint64_t sequence,int64_t timestamp,float lux,uint64_t uptime) {
  hsx_reading_t reading={.channel=HSX_CHANNEL,.value=lux,.min=0.0f,.max=65535.0f,.synthetic=0};
  return hsx_encode_readings(output,capacity,device,sequence,timestamp,&reading,1,uptime);
}
