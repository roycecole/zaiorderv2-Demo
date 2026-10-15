// src/features/kiosk/index.ts —— 觸控面板模式的對外介面
export { IdleGuard } from './IdleGuard';
export { KioskDoneCountdown } from './KioskDoneCountdown';
export { clearKioskSessionData, useKioskReset } from './kioskReset';
export { KIOSK_RESET_EVENT, dispatchKioskReset, onKioskReset } from './resetEvent';
export { hasUnknownOrderResult } from './unknownResult';
