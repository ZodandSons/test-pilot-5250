// Telnet (RFC 854/855/885/1091/1205/1572/2877)
export const TN = {
  IAC: 255, DONT: 254, DO: 253, WONT: 252, WILL: 251, SB: 250, SE: 240, EOR: 239,
  OPT_BINARY: 0, OPT_TERMINAL_TYPE: 24, OPT_EOR: 25, OPT_NEW_ENVIRON: 39,
  TT_IS: 0, TT_SEND: 1,
  ENV_IS: 0, ENV_SEND: 1, ENV_INFO: 2, ENV_VAR: 0, ENV_VALUE: 1, ENV_ESC: 2, ENV_USERVAR: 3,
};

// 5250 GDS record
export const RECORD_TYPE_GDS = 0x12a0;
export const OPCODE = {
  NO_OP: 0x00, INVITE: 0x01, OUTPUT_ONLY: 0x02, PUT_GET: 0x03, SAVE_SCREEN: 0x04,
  RESTORE_SCREEN: 0x05, READ_IMMEDIATE: 0x06, READ_SCREEN: 0x08, CANCEL_INVITE: 0x0a,
  MSG_LIGHT_ON: 0x0b, MSG_LIGHT_OFF: 0x0c,
};
export const HDR_FLAG = { ERR: 0x80, ATN: 0x40, SRQ: 0x04, TRQ: 0x02, HLP: 0x01 };

// 5250 commands (preceded by ESC 0x04)
export const ESC = 0x04;
export const CMD = {
  CLEAR_UNIT: 0x40, CLEAR_UNIT_ALT: 0x20, CLEAR_FORMAT_TABLE: 0x50,
  WRITE_TO_DISPLAY: 0x11, WRITE_ERROR_CODE: 0x21, WRITE_ERROR_CODE_WINDOW: 0x22,
  READ_INPUT_FIELDS: 0x42, READ_MDT_FIELDS: 0x52, READ_MDT_ALT: 0x82,
  READ_SCREEN: 0x62, READ_IMMEDIATE: 0x72, READ_IMMEDIATE_ALT: 0x83,
  SAVE_SCREEN: 0x02, SAVE_PARTIAL_SCREEN: 0x03, RESTORE_SCREEN: 0x12, RESTORE_PARTIAL_SCREEN: 0x13,
  ROLL: 0x23, WRITE_STRUCTURED_FIELD: 0xf3, WRITE_SINGLE_STRUCTURED_FIELD: 0xf4,
};
export const READ_CMDS = new Set([0x42, 0x52, 0x82, 0x62, 0x72, 0x83]);

// Orders inside Write To Display
export const ORDER = {
  SOH: 0x01, RA: 0x02, EA: 0x03, TD: 0x10, SBA: 0x11, WEA: 0x12, IC: 0x13, MC: 0x14,
  WDSF: 0x15, SF: 0x1d,
};

// AID codes
export const AID = {
  Enter: 0xf1, Help: 0xf3, PageUp: 0xf4, PageDown: 0xf5, RollDown: 0xf4, RollUp: 0xf5,
  Print: 0xf6, RecordBackspace: 0xf8, Clear: 0xbd, AutoEnter: 0x3f, InboundWSF: 0x88,
};
for (let i = 1; i <= 12; i++) AID['F' + i] = 0x30 + i;
for (let i = 13; i <= 24; i++) AID['F' + i] = 0xb0 + (i - 12);
export const AID_NAME = Object.fromEntries(
  Object.entries(AID).filter(([k]) => !['RollDown', 'RollUp', 'AutoEnter', 'InboundWSF'].includes(k)).map(([k, v]) => [v, k])
);
export const NON_AID_KEYS = new Set(['Attn', 'SysReq']);

// Field format word (FFW byte 1 / byte 2)
export const FFW = {
  BYPASS: 0x20, DUP: 0x10, MDT: 0x08, SHIFT_MASK: 0x07,
  AUTO_ENTER: 0x80, FER: 0x40, MONOCASE: 0x20, MANDATORY_ENTER: 0x08, ADJUST_MASK: 0x07,
};
export const SHIFT = {
  ALPHA_SHIFT: 0, ALPHA_ONLY: 1, NUMERIC_SHIFT: 2, NUMERIC_ONLY: 3, KATAKANA: 4,
  DIGITS_ONLY: 5, IO: 6, SIGNED_NUMERIC: 7,
};
export const ADJUST = { NONE: 0, RIGHT_ZERO: 5, RIGHT_BLANK: 6, MANDATORY_FILL: 7 };

// Display attribute bytes 0x20-0x3F
export function decodeAttr(a) {
  const low = a & 0x07;
  const base = a & 0xf8;
  const hi = (a & 0x02) !== 0;
  let color = 'green';
  if (base === 0x20) color = hi ? 'white' : 'green';
  else if (base === 0x28) color = 'red';
  else if (base === 0x30) color = hi ? 'yellow' : 'turquoise';
  else if (base === 0x38) color = hi ? 'blue' : 'pink';
  return {
    color,
    reverse: (low & 1) === 1 && low !== 7,
    underline: (low & 4) === 4 && low !== 7,
    hidden: low === 7,
  };
}
export const ATTR = {
  GREEN: 0x20, GREEN_RI: 0x21, WHITE: 0x22, GREEN_UL: 0x24, WHITE_UL: 0x26, NONDISPLAY: 0x27,
  RED: 0x28, RED_RI: 0x29, TURQ: 0x30, YELLOW: 0x32, TURQ_UL: 0x34, PINK: 0x38, BLUE: 0x3a,
};
