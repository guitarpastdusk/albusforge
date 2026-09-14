#include "hsx-wire.h"
#include "hsx-channels.h"
#include <assert.h>
#include <math.h>
#include <stdio.h>
#include <string.h>
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
  /* Several sensors share one packet. */
  hsx_reading_t many[4]={
    {HSX_CH_ILLUMINANCE,123.5f,HSX_MIN_ILLUMINANCE,HSX_MAX_ILLUMINANCE,0},
    {HSX_CH_TEMPERATURE,21.25f,HSX_MIN_TEMPERATURE,HSX_MAX_TEMPERATURE,0},
    {HSX_CH_HUMIDITY,48.5f,HSX_MIN_HUMIDITY,HSX_MAX_HUMIDITY,0},
    {HSX_CH_PRESSURE,1008.25f,HSX_MIN_PRESSURE,HSX_MAX_PRESSURE,0}};
  assert(hsx_encode_readings(packet,sizeof packet,dev,7,1800000000,many,4,30)>0);puts(packet);
  assert(strstr(packet,"\"c\":\"temperature\"")&&strstr(packet,"\"c\":\"pressure\""));
  assert(strstr(packet,"\"health\":[]"));
  /* A stubbed value is always declared in st.health. */
  hsx_reading_t stubbed[2]={
    {HSX_CH_ILLUMINANCE,123.5f,HSX_MIN_ILLUMINANCE,HSX_MAX_ILLUMINANCE,0},
    {HSX_CH_SOIL_MOISTURE,900.0f,HSX_MIN_SOIL_MOISTURE,HSX_MAX_SOIL_MOISTURE,1}};
  assert(hsx_encode_readings(packet,sizeof packet,dev,8,1800000000,stubbed,2,30)>0);puts(packet);
  assert(strstr(packet,"\"health\":[\"synthetic:soil_moisture\"]"));
  /* Out-of-range, duplicate, unnamed, empty, oversized and short-buffer cases. */
  hsx_reading_t bad[2]={
    {HSX_CH_TEMPERATURE,120.0f,HSX_MIN_TEMPERATURE,HSX_MAX_TEMPERATURE,0},
    {HSX_CH_HUMIDITY,10.0f,HSX_MIN_HUMIDITY,HSX_MAX_HUMIDITY,0}};
  assert(hsx_encode_readings(packet,sizeof packet,dev,1,1800000000,bad,2,0)<0);
  hsx_reading_t duplicate[2]={
    {HSX_CH_TEMPERATURE,20.0f,HSX_MIN_TEMPERATURE,HSX_MAX_TEMPERATURE,0},
    {HSX_CH_TEMPERATURE,21.0f,HSX_MIN_TEMPERATURE,HSX_MAX_TEMPERATURE,0}};
  assert(hsx_encode_readings(packet,sizeof packet,dev,1,1800000000,duplicate,2,0)<0);
  hsx_reading_t named[1]={{"Illuminance",1.0f,0.0f,10.0f,0}};
  assert(hsx_encode_readings(packet,sizeof packet,dev,1,1800000000,named,1,0)<0);
  named[0].channel=NULL;
  assert(hsx_encode_readings(packet,sizeof packet,dev,1,1800000000,named,1,0)<0);
  assert(hsx_encode_readings(packet,sizeof packet,dev,1,1800000000,many,0,0)<0);
  assert(hsx_encode_readings(packet,sizeof packet,dev,1,1800000000,many,HSX_MAX_READINGS+1,0)<0);
  assert(hsx_encode_readings(packet,sizeof packet,dev,1,1800000000,NULL,1,0)<0);
  assert(hsx_encode_readings(packet,40,dev,1,1800000000,many,4,0)<0);
}
