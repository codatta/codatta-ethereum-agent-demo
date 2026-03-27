const COLORS = {
  reset: "\x1b[0m",
  bright: "\x1b[1m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  blue: "\x1b[34m",
  magenta: "\x1b[35m",
  cyan: "\x1b[36m",
  gray: "\x1b[90m",
};

export function step(num: number, title: string) {
  console.log(
    `\n${COLORS.bright}${COLORS.blue}=== Step ${num}: ${title} ===${COLORS.reset}`
  );
}

export function info(msg: string, value?: string | number | bigint) {
  if (value !== undefined) {
    console.log(`  ${COLORS.cyan}${msg}${COLORS.reset} ${value}`);
  } else {
    console.log(`  ${COLORS.cyan}${msg}${COLORS.reset}`);
  }
}

export function success(msg: string) {
  console.log(`  ${COLORS.green}✓ ${msg}${COLORS.reset}`);
}

export function header(msg: string) {
  console.log(
    `\n${COLORS.bright}${COLORS.magenta}${"=".repeat(50)}${COLORS.reset}`
  );
  console.log(`${COLORS.bright}${COLORS.magenta}  ${msg}${COLORS.reset}`);
  console.log(
    `${COLORS.bright}${COLORS.magenta}${"=".repeat(50)}${COLORS.reset}`
  );
}

export function summary(lines: Record<string, string | number | bigint>) {
  console.log(
    `\n${COLORS.bright}${COLORS.yellow}--- Summary ---${COLORS.reset}`
  );
  for (const [key, val] of Object.entries(lines)) {
    console.log(`  ${COLORS.yellow}${key}:${COLORS.reset} ${val}`);
  }
}
