#include "hsx-wire.h"
#include <assert.h>
#include <math.h>
#include <stdio.h>
int main(void) {
  char packet[1024];const char *dev="11111111-1111-4111-8111-111111111111";
  assert(hsx_encode_packet(packet,sizeof packet,dev,0,1800000000,0,0)>0);puts(packet);
  assert(hsx_encode_packet(packet,sizeof packet,dev,9007199254740991ULL,1800000000,54612.5f,20)>0);puts(packet);
  assert(hsx_encode_packet(packet,sizeof packet,dev,1,1800000000,NAN,0)<0);
  assert(hsx_encode_packet(packet,sizeof packet,dev,1,1800000000,INFINITY,0)<0);
  assert(hsx_encode_packet(packet,sizeof packet,dev,1,1800000000,-1,0)<0);
  assert(hsx_encode_packet(packet,sizeof packet,dev,1,0,20,0)<0);
  assert(hsx_encode_packet(packet,sizeof packet,dev,9007199254740992ULL,1800000000,20,0)<0);
  assert(hsx_encode_packet(packet,10,dev,1,1800000000,20,0)<0);
  assert(hsx_encode_packet(packet,sizeof packet,"\"1111111-1111-4111-8111-111111111111",1,1800000000,20,0)<0);
}
