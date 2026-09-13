export type AndroidAutomationCommandRunner = (command: readonly string[]) => Promise<unknown>;

export async function prepareAndroidForAutomation(
  runCommand: AndroidAutomationCommandRunner
): Promise<void> {
  await runCommand(["input", "keyevent", "KEYCODE_WAKEUP"]);
  await runCommand(["wm", "dismiss-keyguard"]);
}
