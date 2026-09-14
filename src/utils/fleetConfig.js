// Fleet roster (aircraft types + tail registrations), company-editable at
// Settings > Fleet Configuration. Separate from ftl_limits since this is
// fleet data, not a regulatory FTL number - stored under its own
// "fleet_config" app_settings key so it doesn't clutter that file, but
// synced the same way (via getSetting/saveSetting) to every machine.
export const DEFAULT_FLEET_CONFIG = {
  aircraftTypes: ["AW139"],
  registrations: []
};

export function withFleetDefaults(saved) {
  if (!saved) return DEFAULT_FLEET_CONFIG;
  return {
    aircraftTypes: saved.aircraftTypes?.length ? saved.aircraftTypes : DEFAULT_FLEET_CONFIG.aircraftTypes,
    registrations: saved.registrations || DEFAULT_FLEET_CONFIG.registrations
  };
}
