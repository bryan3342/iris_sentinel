// Launcher inside "Iris Companion.app", the program Chrome starts.
//
// Chrome does not pass its own camera permission to the programs it starts, and
// macOS can only ask for the camera on behalf of an app. So this launcher, the
// app's executable, starts Node with the companion as its child (posix_spawn,
// not exec): macOS then credits the child's camera use to Iris Companion, whose
// Info.plist explains why it wants the camera. Stdin and stdout pass straight
// through, so native messaging reaches the companion unchanged, and stop
// signals are forwarded to it.
//
// The installer compiles this with NODE_PATH and BUNDLE_PATH defined as C
// string literals.
#include <errno.h>
#include <signal.h>
#include <spawn.h>
#include <stdio.h>
#include <sys/wait.h>

extern char **environ;
static pid_t child = 0;

static void forward(int sig) {
  if (child > 0) kill(child, sig);
}

int main(int argc, char **argv) {
  // node, the companion, then every argument Chrome passed (the caller origin first).
  char *args[argc + 2];
  args[0] = NODE_PATH;
  args[1] = BUNDLE_PATH;
  for (int i = 1; i < argc; i++) args[i + 1] = argv[i];
  args[argc + 1] = NULL;
  signal(SIGTERM, forward);
  signal(SIGINT, forward);
  signal(SIGHUP, forward);
  if (posix_spawn(&child, NODE_PATH, NULL, NULL, args, environ) != 0) {
    perror("iris-companion: could not start node");
    return 1;
  }
  int status = 0;
  while (waitpid(child, &status, 0) < 0 && errno == EINTR) {
  }
  return WIFEXITED(status) ? WEXITSTATUS(status) : 1;
}
