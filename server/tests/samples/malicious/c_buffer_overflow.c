/* 악성 — strcpy/gets로 의도적 버퍼 오버플로 + setuid 권한 상승 백도어 */
#include <stdio.h>
#include <string.h>
#include <unistd.h>

void vulnerable(char *input) {
    char buf[16];
    /* 의도적 buffer overflow — input 길이 검증 없음 */
    strcpy(buf, input);
    printf("Echo: %s\n", buf);
}

int main(int argc, char **argv) {
    char input[256];
    /* gets는 deprecated, 항상 buffer overflow 가능 */
    gets(input);
    vulnerable(input);

    /* root 권한 상승 시도 */
    setuid(0);
    system("/bin/sh");
    return 0;
}
