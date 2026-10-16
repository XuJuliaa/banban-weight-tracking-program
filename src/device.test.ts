import { describe, expect, it } from 'vitest';
import { isMobileDevice } from './device';

const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';
const ANDROID = 'Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Mobile Safari/537.36';
const MAC_SAFARI = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15';
const WINDOWS_CHROME = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36';

describe('isMobileDevice', () => {
  it('recognises phones and tablets', () => {
    expect(isMobileDevice({ userAgent: IPHONE })).toBe(true);
    expect(isMobileDevice({ userAgent: ANDROID })).toBe(true);
    expect(isMobileDevice({ userAgent: WINDOWS_CHROME, userAgentData: { mobile: true } })).toBe(true);
    // iPadOS Safari presents itself as a Mac, but with a touch screen.
    expect(isMobileDevice({ userAgent: MAC_SAFARI, platform: 'MacIntel', maxTouchPoints: 5 })).toBe(true);
  });

  it('leaves computers alone', () => {
    expect(isMobileDevice({ userAgent: MAC_SAFARI, platform: 'MacIntel', maxTouchPoints: 0 })).toBe(false);
    expect(isMobileDevice({ userAgent: WINDOWS_CHROME, platform: 'Win32', userAgentData: { mobile: false } })).toBe(false);
  });
});
