import type { Lesson } from './lessons';

export const studentSystemLesson: Lesson = {
  id: 'student-system', number: '23', title: '最终章：学生成绩管理系统', subtitle: '把语法、模块与业务规则组合成一个小系统', group: '常用 C 用法与综合实践', time: '60 分钟', tags: ['综合项目', '增删改查', '统计'],
  intro: '一个浏览器内真实运行的命令式小系统。入口读取命令，业务层检查规则，存储层维护结构体数组。支持录入、查询、修改、删除、列表、平均分与最高分，并处理重复学号、非法成绩和容量不足。',
  concepts: [
    { title: '先理解命令协议，再运行', text: '在「输入」面板预先填写命令，运行时按顺序读取：1 学号 姓名 成绩＝录入；2 学号＝查询；3 学号 新成绩＝修改；4 学号＝删除；5＝统计；6＝列表；0＝退出。姓名用不含空格的英文，最多 15 个字符。预置输入覆盖成功与失败场景，可直接改写。' },
    { title: '三个模块与一个配置入口', text: 'main.c 负责输入输出；service.c 校验业务规则并计算统计；store.c 私有保存 Student 数组。config.h 定义容量、姓名长度、成绩范围和统计开关。修改实现后，用输出与回放检查系统行为，数据仅保存在本次运行内存中。' },
  ],
  prediction: '录入 Alice 86、Bob 59、Carol 92，再把 Bob 改为 75，平均分与最高分是谁？重复录入学号 101 会覆盖原记录吗？',
  answer: '平均分为 84.3，最高分为 Carol 的 92。重复录入返回 DUPLICATE，不会覆盖 Alice。删除 Alice 后，列表只有 Bob 和 Carol。',
  pitfalls: ['改了代码没重新运行，看到的还是旧轨迹；右侧的过期横幅就是在提醒这件事。', '绕过 service 直接改 store 的数据，重复学号、非法成绩这些业务规则就全部失效。', '命令输入少一个空格，scanf 的匹配数就不对，注意 BAD_INPUT 分支的提示。'],
  deeper: [{ title: '读项目的顺序', text: '先看 model.h 知道数据长什么样，再看 store.h 能存什么、service.h 有什么规则，最后读 main.c 怎么串起来。接口先行，读任何项目都有了地图。' }, { title: '从这里到真实项目', text: '真实系统还需要文件保存（当前引擎不支持）、排序查询和并发保护。但「入口 / 业务 / 存储」三层、接口先行、规则集中在业务层，这些骨架在一万行的项目里依然成立。' }],
  challenge: '先把 CAPACITY 改为 2 验证 FULL 分支；再增加“及格人数”统计。最后增加按成绩排序的命令：声明接口、实现规则、在 main 装配，检查删除与查询仍正确。',
  input: '1 101 Alice 86\n1 102 Bob 59\n1 103 Carol 92\n1 101 Repeat 77\n2 102\n3 102 75\n5\n4 101\n6\n3 999 70\n0\n',
  expected: 'STUDENT SYSTEM\n1:add 2:find 3:update 4:delete 5:stats 6:list 0:exit\nADD OK\nADD OK\nADD OK\nADD DUPLICATE\n102 Bob 59\nUPDATE OK\ncount=3 average=84.3\nbest=103 Carol 92\nDELETE OK\n102 Bob 75\n103 Carol 92\nUPDATE NOT_FOUND\nBYE\n',
  code: `#include <stdio.h>
#include "config.h"
#include "service.h"

/* 展示层：命令与业务模块之间的适配。 */
char *status_text(Result result) {
    switch (result) {
        case OK: return "OK";
        case DUPLICATE: return "DUPLICATE";
        case NOT_FOUND: return "NOT_FOUND";
        case INVALID: return "INVALID";
        default: return "FULL";
    }
}

void show_student(Student *student) {
    if (student == NULL) {
        puts("NOT_FOUND");
        return;
    }
    printf("%d %s %d\\n", student->id, student->name, student->score);
}

int main(void) {
    int command, id, score;
    char name[NAME_LENGTH];
    puts("STUDENT SYSTEM");
    puts("1:add 2:find 3:update 4:delete 5:stats 6:list 0:exit");
    while (scanf("%d", &command) == 1) {
        if (command == 0) break;
        if (command == 1) {
            if (scanf("%d " NAME_FORMAT " %d", &id, name, &score) != 3) {
                puts("BAD_INPUT");
                break;
            }
            Result result = add_student(id, name, score);
            printf("ADD %s\\n", status_text(result));
        } else if (command == 2) {
            if (scanf("%d", &id) != 1) { puts("BAD_INPUT"); break; }
            show_student(find_student(id));
        } else if (command == 3) {
            if (scanf("%d %d", &id, &score) != 2) { puts("BAD_INPUT"); break; }
            Result result = update_score(id, score);
            printf("UPDATE %s\\n", status_text(result));
        } else if (command == 4) {
            if (scanf("%d", &id) != 1) { puts("BAD_INPUT"); break; }
            printf("DELETE %s\\n", status_text(delete_student(id)));
        } else if (command == 5) {
#if ENABLE_STATS
            printf("count=%d average=%.1f\\n", student_count(), average_score());
            Student *best = top_student();
            if (best != NULL) {
                printf("best=%d %s %d\\n", best->id, best->name, best->score);
            }
#else
            puts("STATS_DISABLED");
#endif
        } else if (command == 6) {
            for (int i = 0; i < student_count(); i++) show_student(student_at(i));
        } else {
            puts("UNKNOWN_COMMAND");
        }
    }
    puts("BYE");
    return 0;
}
`,
  files: {
    'config.h': `#ifndef CONFIG_H
#define CONFIG_H

#define CAPACITY 4
#define NAME_MAX 15
#define NAME_LENGTH (NAME_MAX + 1)
#define MIN_SCORE 0
#define MAX_SCORE 100
#define ENABLE_STATS 1

/* 两层展开：先把 NAME_MAX 展开，再字符串化。 */
#define TEXT_INNER(x) #x
#define TEXT(x) TEXT_INNER(x)
#define NAME_FORMAT "%" TEXT(NAME_MAX) "s"

#if CAPACITY < 1 || NAME_MAX < 1
#error Capacity and name length must be positive
#endif
#endif
`,
    'model.h': `#ifndef MODEL_H
#define MODEL_H
#include "config.h"

typedef struct Student {
    int id;
    char name[NAME_LENGTH];
    int score;
} Student;

typedef enum Result {
    OK, DUPLICATE, NOT_FOUND, INVALID, FULL
} Result;
#endif
`,
    'store.h': `#ifndef STORE_H
#define STORE_H
#include "model.h"

int store_count(void);
Student *store_at(int index);
Student *store_find(int id);
int store_insert(int id, char *name, int score);
int store_remove(int id);
#endif
`,
    'store.c': `#include <string.h>
#include "store.h"

/* 数据只属于存储模块。每次运行从空表开始。 */
static Student records[CAPACITY];
static int used = 0;

int store_count(void) { return used; }

Student *store_at(int index) {
    if (index < 0 || index >= used) return NULL;
    return &records[index];
}

Student *store_find(int id) {
    for (int i = 0; i < used; i++) {
        if (records[i].id == id) return &records[i];
    }
    return NULL;
}

int store_insert(int id, char *name, int score) {
    if (used >= CAPACITY) return 0;
    records[used].id = id;
    strcpy(records[used].name, name);
    records[used].score = score;
    used++;
    return 1;
}

int store_remove(int id) {
    for (int i = 0; i < used; i++) {
        if (records[i].id == id) {
            for (int j = i; j < used - 1; j++) {
                records[j] = records[j + 1];
            }
            used--;
            return 1;
        }
    }
    return 0;
}
`,
    'service.h': `#ifndef SERVICE_H
#define SERVICE_H
#include "model.h"

Result add_student(int id, char *name, int score);
Result update_score(int id, int score);
Result delete_student(int id);
int student_count(void);
Student *find_student(int id);
Student *student_at(int index);
double average_score(void);
Student *top_student(void);
#endif
`,
    'service.c': `#include <string.h>
#include "service.h"
#include "store.h"

int student_count(void) { return store_count(); }
Student *find_student(int id) { return store_find(id); }
Student *student_at(int index) { return store_at(index); }

static int valid_score(int score) {
    return score >= MIN_SCORE && score <= MAX_SCORE;
}

Result add_student(int id, char *name, int score) {
    if (id <= 0 || !valid_score(score) || strlen(name) >= NAME_LENGTH) return INVALID;
    if (store_find(id) != NULL) return DUPLICATE;
    if (!store_insert(id, name, score)) return FULL;
    return OK;
}

Result update_score(int id, int score) {
    if (!valid_score(score)) return INVALID;
    Student *student = store_find(id);
    if (student == NULL) return NOT_FOUND;
    student->score = score;
    return OK;
}

Result delete_student(int id) {
    return store_remove(id) ? OK : NOT_FOUND;
}

double average_score(void) {
    int count = store_count();
    if (count == 0) return 0.0;
    int total = 0;
    for (int i = 0; i < count; i++) {
        Student *student = store_at(i);
        total += student->score;
    }
    return (double)total / count;
}

Student *top_student(void) {
    Student *best = NULL;
    for (int i = 0; i < store_count(); i++) {
        Student *candidate = store_at(i);
        if (best == NULL || candidate->score > best->score) best = candidate;
    }
    return best;
}
`,
  },
};
