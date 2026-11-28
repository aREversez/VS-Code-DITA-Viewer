// The key under which a path is compared with another: backslashes become forward
// slashes, so a Windows-style and a POSIX-style path to one file compare equal,
// and the path is lower-cased when the host's file system ignores case (the Node
// platform says so for Windows only; macOS and Linux stay case-sensitive).

export function comparablePath(path: string, caseSensitive: boolean): string {
  const slashed = path.replace(/\\/g, '/');
  return caseSensitive ? slashed : slashed.toLowerCase();
}
