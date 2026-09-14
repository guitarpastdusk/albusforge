/* Host-native probe of the exact encoder linked into the ESP32-S3 firmware.
 * Arguments contain public identity/readings only, never an ingestion token. */
#include "hsx-wire.h"
#include <stdio.h>
#include <stdlib.h>
int main(int argc,char **argv) {
 if(argc!=6)return 2;
 char *end;unsigned long long seq=strtoull(argv[2],&end,10);if(!*argv[2]||*end)return 2;
 long long ts=strtoll(argv[3],&end,10);if(!*argv[3]||*end)return 2;
 float lux=strtof(argv[4],&end);if(!*argv[4]||*end)return 2;
 unsigned long long uptime=strtoull(argv[5],&end,10);if(!*argv[5]||*end)return 2;
 char packet[1024];if(hsx_encode_packet(packet,sizeof packet,argv[1],seq,ts,lux,uptime)<0)return 2;
 puts(packet);return 0;
}
