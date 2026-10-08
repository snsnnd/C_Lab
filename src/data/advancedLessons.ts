import type { Lesson } from './lessons';
import { studentSystemLesson } from './studentSystemLesson';

export const advancedLessons: Lesson[] = [
  {
    id: 'macros', number: '19', title: '宏定义与展开', subtitle: '先替换记号，再解释执行', group: '常用 C 用法与综合实践', time: '25 分钟', tags: ['#define', '函数式宏', '# / ##'],
    intro: '宏不是函数。预处理器在运行前替换源码记号，展开结果才交给 C 解析器。逐步高亮仍指向你写的宏调用位置。',
    concepts: [{ title: '常量宏与函数式宏', text: 'LIMIT 是对象宏，CLAMP 是带参数宏。替换式的参数与整体都加括号，避免优先级改变结果。不要向可能多次使用参数的宏传入 i++ 等有副作用的表达式。' }, { title: '字符串化与拼接', text: '# 将参数记号变为字符串，## 拼接成一个记号。这里 CAT(score, _value) 生成变量名 score_value；LABEL(score) 生成字符串 "score"。反斜杠换行可拆分长宏定义。' }],
    prediction: '把输入从 90 改成 120，CLAMP 的结果是多少？宏本身会出现调用栈吗？', answer: '结果为 100。宏在运行前展开，不会新增函数调用帧。展开出的比较、变量变化仍按真实执行记录。',
    pitfalls: ['宏参数不加括号：#define SQUARE(x) x*x 遇到 SQUARE(2+3) 会展开成 2+3*2+3。', '传入 i++ 这类有副作用的表达式：宏可能把参数展开多次，i 就被加了不止一次。', '宏没有类型检查：把字符串传给数字宏，编译器不吭声，错误暴露得更晚更隐蔽。'],
    deeper: [{ title: '预处理发生在编译之前', text: '预处理器做的是纯文本替换：宏名换成替换体，# 把记号变成字符串，## 把记号拼起来。点开「查看预处理结果」，看到的就是编译器真正拿到的代码。' }, { title: '什么场合还值得用宏', text: '常量首选 const 或枚举（有类型、可调试），小函数首选普通函数。宏留给必须做文本操作的场景：通用拼接、条件编译、头文件保护。' }],
    challenge: '定义带完整括号的 SQUARE(x) 宏，比较 SQUARE(2 + 3) 与不加括号的版本。然后把它改成普通函数，观察调用层的区别。',
    code: '#include <stdio.h>\n\n#define LIMIT 100\n#define CLAMP(x) \\\n    ((x) > LIMIT ? LIMIT : (x))\n#define LABEL(x) #x\n#define CAT(a, b) a##b\n\nint main(void) {\n    int CAT(score, _value) = CLAMP(90);\n    printf("%s = %d\\n", LABEL(score), score_value);\n    printf("limit = %d\\n", LIMIT);\n    return 0;\n}\n', input: '', expected: 'score = 90\nlimit = 100\n',
  },
  {
    id: 'conditional-build', number: '20', title: '条件编译与项目配置', subtitle: '一份源码，选择不同的编译分支', group: '常用 C 用法与综合实践', time: '25 分钟', tags: ['#if', 'defined', '#undef'],
    intro: '把编译选项放进 config.h。main.c 和 rules.c 分别包含它，得到一致配置。条件编译去掉未选中的源码，和运行时 if 的含义不同。',
    concepts: [{ title: '预处理分支没有运行步骤', text: '#if/#elif/#else/#endif 在运行前选择源码。未选中的分支不会被执行，也不会出现运行时条件判断。普通 if 仍在程序执行过程中判断。' }, { title: '每个翻译单元有自己的宏环境', text: '头文件配置需要分别 include。一个 .c 中临时 #define 的名字不会自动传到另一个 .c。可以用 #undef 取消宏，用 defined(NAME) 检查它是否存在。' }],
    prediction: '将 DEBUG_MODE 改为 0 后，输出中的 mode 会如何变化？', answer: '会从 debug 变成 release。合格线仍为 PASS_SCORE，passed(72) 的结果仍是 1。',
    pitfalls: ['把 #if 当成运行时 if：预处理分支在编译前就选定，不会随运行数据改变。', '#if 里引用未定义的宏会被当作 0，容易「默默」走错分支，建议配合 defined() 判断。', '忘记 #endif 时，报错位置离真相很远；写 #if 的同时先把 #endif 补上。'],
    deeper: [{ title: '每个翻译单元独立', text: 'config.h 被 main.c 和 rules.c 分别包含，两边必须看到一致的宏；而某个 .c 里临时定义的宏别的文件看不到——这既是隔离，也是陷阱。' }, { title: '调试开关的标准做法', text: '定义 DEBUG 宏配合 #if DEBUG 的日志块，发布时改成 0 整段消失，运行时零开销，比到处注释 printf 体面得多。' }],
    challenge: '将 PASS_SCORE 改为 80，预测结果。再用 #if PASS_SCORE > 100 和 #error 为不合理配置添加诊断。',
    code: '#include <stdio.h>\n#include "config.h"\n#include "rules.h"\n\nint main(void) {\n#if defined(DEBUG_MODE) && DEBUG_MODE\n    printf("mode=debug\\n");\n#else\n    printf("mode=release\\n");\n#endif\n    printf("pass=%d\\n", passed(72));\n    return 0;\n}\n',
    files: {
      'config.h': '#ifndef CONFIG_H\n#define CONFIG_H\n\n#define DEBUG_MODE 1\n#define PASS_SCORE 60\n\n#endif\n',
      'rules.h': '#ifndef RULES_H\n#define RULES_H\nint passed(int score);\n#endif\n',
      'rules.c': '#include "config.h"\n#include "rules.h"\n\nint passed(int score) {\n    return score >= PASS_SCORE;\n}\n',
    }, input: '', expected: 'mode=debug\npass=1\n',
  },
  {
    id: 'static-flags', number: '21', title: '静态局部变量与位标志', subtitle: '保存调用历史，用位组合表示状态', group: '常用 C 用法与综合实践', time: '25 分钟', tags: ['static', 'stdbool', '位运算'],
    intro: '普通局部变量每次调用重新创建；静态局部变量只初始化一次，在后续调用中保留数值。位标志让一个整数表达多个独立开关。',
    concepts: [{ title: '作用域不等于生命周期', text: 'counter 只能在 next_id 内按名字访问，却在函数返回后继续存在。再次调用会取回同一个存储位置。新一次运行才会重新初始化。' }, { title: '设置、检查与清除位', text: '用 | 设置标志，用 & 检查标志，用 & ~ 清除标志。bool 来自 stdbool.h，赋值时将非零值规范为 1。uint8_t 来自 stdint.h。' }],
    prediction: '两次 next_id() 得到什么？清除 FLAG_SAVED 后，FLAG_ACTIVE 还在吗？', answer: '编号分别是 1 和 2。清除位只影响 FLAG_SAVED，FLAG_ACTIVE 仍为 1。',
    pitfalls: ['static 局部变量只在第一次执行到时初始化，之后每次调用都带着上一次的值。', '& 和 | 的优先级低于 ==：flags & MASK == 0 实际是 flags & (MASK == 0)，必须加括号。', '清位写成 flags &= ~FLAG 时漏掉 ~，逻辑就整个反了。'],
    deeper: [{ title: '作用域与生命周期', text: 'static 局部变量的作用域仍只在函数内，生命周期却贯穿整个运行期。第 23 课 store.c 的 static records 数组同理：程序活着，数据就在。' }, { title: '一个字节管八个开关', text: '1 << n 把 1 挪到第 n 位；| 开灯，& 检查，& ~ 关灯。配置项、权限、状态标志都用它表达，比八个 bool 紧凑，也更接近硬件的真实做法。' }],
    challenge: '新增 FLAG_REVIEWED 为 1 << 2，设置后再清除 ACTIVE，逐步观察 flags 的变化。把 counter 的 static 删除，比较编号。',
    code: '#include <stdio.h>\n#include <stdbool.h>\n#include <stdint.h>\n\n#define FLAG_ACTIVE (1 << 0)\n#define FLAG_SAVED  (1 << 1)\n\nint next_id(void) {\n    static int counter = 0;\n    return ++counter;\n}\n\nint main(void) {\n    int first = next_id();\n    int second = next_id();\n    uint8_t flags = FLAG_ACTIVE | FLAG_SAVED;\n    bool saved = (flags & FLAG_SAVED) != 0;\n    printf("ids=%d,%d saved=%d flags=%d\\n", first, second, saved, flags);\n    flags &= ~FLAG_SAVED;\n    printf("flags=%d\\n", flags);\n    return 0;\n}\n', input: '', expected: 'ids=1,2 saved=1 flags=3\nflags=1\n',
  },
  {
    id: 'dynamic-memory', number: '22', title: '动态内存与资源归还', subtitle: '申请、检查、使用、释放', group: '常用 C 用法与综合实践', time: '25 分钟', tags: ['calloc', 'sizeof', 'NULL / free'],
    intro: '动态数组的容量可以由运行时数据决定。申请成功后通过指针访问元素，完成使用后释放；不把指针变量与它指向的内存混为一谈。',
    concepts: [{ title: '用 sizeof 计算字节数', text: 'calloc(count, sizeof(int)) 申请 count 个 int 的空间，并将所有字节清零。检查返回值是否为 NULL，再读写数组元素。' }, { title: '释放后不再访问', text: 'free 归还堆内存，指针变量本身仍存在。设为 NULL 可以避免通过这个变量继续使用旧对象，但其他别名不会自动清空。' }],
    prediction: '三个元素依次写入 3、6、9，total 是多少？free 后指针变量会自动为 NULL 吗？', answer: 'total 为 18。不会自动为 NULL，所以示例显式赋值 values = NULL。',
    pitfalls: ['申请之后忘记 free：界面里的堆面板会显示对象越积越多，这就是泄漏。', 'free 之后继续使用指针（悬垂指针），读取属于未定义行为；释放后立刻置 NULL。', '同一块内存 free 两次，第二次是未定义行为；谁申请谁释放要成对出现。'],
    deeper: [{ title: '栈与堆的分工', text: '局部变量在栈上，函数返回自动回收；malloc 的内存在堆上，自己申请自己归还。第 23 课若记录数量事先不可知，就该把静态数组换成堆分配。' }, { title: '所有权约定', text: 'C 没有垃圾回收，「谁申请谁释放」必须靠约定写清楚。结构体里存指针时要先想好：释放结构体时，里面的指针谁来还？' }],
    challenge: '修改 COUNT，预测循环次数与总和。把 calloc 换成 malloc(COUNT * sizeof(int))，确保读取前所有元素都已赋值。',
    code: '#include <stdio.h>\n#include <stdlib.h>\n#define COUNT 3\n\nint main(void) {\n    int *values = calloc(COUNT, sizeof(int));\n    if (values == NULL) return EXIT_FAILURE;\n    int total = 0;\n    for (int i = 0; i < COUNT; i++) {\n        values[i] = (i + 1) * 3;\n        total += values[i];\n    }\n    printf("total=%d\\n", total);\n    free(values);\n    values = NULL;\n    return EXIT_SUCCESS;\n}\n', input: '', expected: 'total=18\n',
  },
  studentSystemLesson,
];
