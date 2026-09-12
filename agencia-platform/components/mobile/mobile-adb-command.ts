import { escapeArg } from "@yume-chan/adb";

export function escapeAdbCommand(command: readonly string[]): string[] {
  return command.map((argument) => escapeArg(argument));
}
