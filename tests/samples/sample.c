/* C sample for Treelights tests. */
#include <stdio.h>
#include <stdlib.h>
#define MAX_PORTS 1024

typedef struct {
    const char *host;
    int ports[MAX_PORTS];
    size_t count;
} scan_t;

static int is_open(const scan_t *s, int port) {
    for (size_t i = 0; i < s->count; i++) {
        if (s->ports[i] == port) return 1;
    }
    return 0;
}

int main(int argc, char **argv) {
    scan_t s = { .host = "10.0.0.1", .count = 0 };
    if (argc < 2) {
        fprintf(stderr, "usage: %s <port>\n", argv[0]);
        return EXIT_FAILURE;
    }
    int port = atoi(argv[1]);
    printf("%s:%d %s\n", s.host, port, is_open(&s, port) ? "open" : "closed");
    return 0;
}
