// Whether the page is open on a phone or tablet. Those only get "Continue with Google" (see main.ts).

/** The parts of `navigator` used here, so tests can pass their own. */
export interface DeviceInfo {
  userAgent: string;
  maxTouchPoints?: number;
  platform?: string;
  userAgentData?: { mobile?: boolean };
}

/** True on phones and tablets, including iPads, which present themselves as a Mac with a touch screen. */
export function isMobileDevice(device: DeviceInfo = navigator as DeviceInfo): boolean {
  if (device.userAgentData?.mobile) return true;
  if (/Android|iPhone|iPad|iPod|Mobi/i.test(device.userAgent)) return true;
  return device.platform === 'MacIntel' && (device.maxTouchPoints ?? 0) > 1;
}
