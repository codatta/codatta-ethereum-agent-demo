const C = {
  reset: "\x1b[0m",
  bright: "\x1b[1m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  blue: "\x1b[34m",
  magenta: "\x1b[35m",
  cyan: "\x1b[36m",
};

const ROLE_COLORS: Record<string, string> = {
  provider: C.green,
  client: C.yellow,
  evaluator: C.magenta,
};

let currentRole = "";
let roleColor = C.blue;

export function setRole(role: string) {
  currentRole = role.toUpperCase();
  roleColor = ROLE_COLORS[role.toLowerCase()] || C.blue;
}

function prefix(): string {
  return `${roleColor}[${currentRole}]${C.reset}`;
}

export function header(msg: string) {
  console.log(`\n${C.bright}${roleColor}${"=".repeat(50)}${C.reset}`);
  console.log(`${C.bright}${roleColor}  ${msg}${C.reset}`);
  console.log(`${C.bright}${roleColor}${"=".repeat(50)}${C.reset}`);
}

export function step(title: string) {
  console.log(`\n${prefix()} ${C.bright}${C.cyan}${title}${C.reset}`);
}

export function info(msg: string, value?: string | number | bigint) {
  if (value !== undefined) {
    console.log(`${prefix()} ${C.cyan}${msg}${C.reset} ${value}`);
  } else {
    console.log(`${prefix()} ${C.cyan}${msg}${C.reset}`);
  }
}

export function success(msg: string) {
  console.log(`${prefix()} ${C.green}✓ ${msg}${C.reset}`);
}

export function waiting(msg: string) {
  console.log(`${prefix()} ${roleColor}⏳ ${msg}${C.reset}`);
}

export function event(eventName: string, details?: string) {
  console.log(
    `${prefix()} ${C.bright}⚡ Event: ${eventName}${C.reset}${details ? ` — ${details}` : ""}`
  );
}

export function summary(lines: Record<string, string | number | bigint>) {
  console.log(`\n${prefix()} ${C.bright}--- Summary ---${C.reset}`);
  for (const [key, val] of Object.entries(lines)) {
    console.log(`${prefix()} ${key}: ${val}`);
  }
}
