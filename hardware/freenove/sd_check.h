#pragma once

#include "driver/sdmmc_host.h"
#include "esp_vfs_fat.h"
#include "sdmmc_cmd.h"
#include <cstdio>
#include <string>

// Freenove WROOM: CMD=38, CLK=39, D0=40; 1-bit SDMMC.
// Mount and read capacity only. Never format or modify existing files.
inline std::string freenove_check_sd() {
  sdmmc_host_t host = SDMMC_HOST_DEFAULT();
  host.max_freq_khz = SDMMC_FREQ_PROBING;
  sdmmc_slot_config_t slot = SDMMC_SLOT_CONFIG_DEFAULT();
  slot.width = 1;
  slot.clk = GPIO_NUM_39;
  slot.cmd = GPIO_NUM_38;
  slot.d0 = GPIO_NUM_40;
  slot.flags |= SDMMC_SLOT_FLAG_INTERNAL_PULLUP;
  esp_vfs_fat_mount_config_t mount = {};
  mount.format_if_mount_failed = false;
  mount.max_files = 2;
  mount.allocation_unit_size = 16 * 1024;
  sdmmc_card_t *card = nullptr;
  esp_err_t result = esp_vfs_fat_sdmmc_mount("/sdcard", &host, &slot, &mount, &card);
  if (result != ESP_OK) {
    ESP_LOGW("sd_check", "SD mount failed: %s; check card insertion and FAT format", esp_err_to_name(result));
    return std::string("Mount failed: ") + esp_err_to_name(result);
  }
  const auto capacity = static_cast<unsigned long long>(card->csd.capacity) * card->csd.sector_size;
  char status[96];
  snprintf(status, sizeof(status), "Mounted; %llu MiB", capacity / (1024 * 1024));
  ESP_LOGI("sd_check", "%s (capacity read; write test not performed)", status);
  esp_vfs_fat_sdcard_unmount("/sdcard", card);
  return status;
}
