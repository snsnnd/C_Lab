import { architectureLessons } from './architectureLessons';
import { advancedLessons } from './advancedLessons';

export interface Lesson {
  /** Additional .c/.h files; code is the main.c entry file. */
  files?: Record<string, string>;
  id: string;
  number: string;
  title: string;
  subtitle: string;
  group: string;
  time: string;
  tags: string[];
  intro: string;
  concepts: { title: string; text: string }[];
  /** 课堂上最容易踩的坑，讲义里逐条列出。 */
  pitfalls?: string[];
  /** 想往深处再讲一层时的扩展材料。 */
  deeper?: { title: string; text: string }[];
  challenge: string;
  prediction: string;
  answer: string;
  code: string;
  input: string;
  expected: string;
}

export const lessons: Lesson[] = [
  {
    id: 'hello', number: '01', title: '你好，C 语言', subtitle: '让第一行代码发出声音', group: '起步', time: '10 分钟', tags: ['main', 'printf', '输出'],
    intro: '从一段能运行的小程序开始。代码并不神秘：它按规则执行，把结果送到输出窗口。',
    concepts: [{ title: '程序从 main 开始', text: 'main 是这个程序的入口。花括号把函数体包在一起，return 0 表示正常结束。' }, { title: '把文字写到输出', text: 'printf 是标准输出函数。字符串中的 \\n 表示换行，语句末尾需要分号。' }],
    pitfalls: ['中文标点是最常见的首败：分号、引号、括号都必须是英文半角，输入法一切换就会编译失败。', 'printf 的 f 是 format（格式化）的缩写，少写成 print 会被当成未声明的名字。', '字符串里的 \\n 表示换行，必须写在引号里面；写到引号外面就不再是换行符。'],
    deeper: [{ title: '编译与解释', text: '这间实验室在浏览器里逐句解释执行 C 代码；真实的 C 通常先用编译器把整份源码翻译成机器指令再运行。两条路线看到的语言规则是一致的。' }, { title: 'main 的返回值交给谁', text: 'return 0 是在告诉操作系统「正常结束」。在 Linux 终端里运行后用 echo $? 可以看到它，脚本就靠这个值判断程序是否成功。' }],
    challenge: '把问候语换成你的名字，再增加一条 printf，观察输出的先后顺序。', prediction: '两个 printf 会出现在同一行吗？', answer: '不会。每个字符串末尾都有 \\n，因此每次输出后都会换行。',
    code: '#include <stdio.h>\n\nint main() {\n    printf("Hello, C!\\n");\n    printf("Let us explore.\\n");\n    return 0;\n}\n', input: '', expected: 'Hello, C!\nLet us explore.\n',
  },
  {
    id: 'variables', number: '02', title: '变量与赋值', subtitle: '值可以复制，变量各自独立', group: '起步', time: '15 分钟', tags: ['int', '赋值', '表达式'],
    intro: '把变量想成有名字的存储位置。赋值把一个值保存进去，而不是把两个变量永远绑在一起。',
    concepts: [{ title: '名字、类型与值', text: 'int score = 80 声明一个整型变量，并把它初始化为 80。类型决定可表达的数据与运算方式。' }, { title: '赋值复制当时的值', text: 'b = a 之后，修改 a 并不会自动修改 b。右侧变量盒会显示它们各自的状态。' }],
    pitfalls: ['变量没赋初值就使用：读到的内容不确定，界面会诚实地显示「未初始化」。', '= 是赋值不是相等：a = 7 之后 a 的旧值就没了，比较两个值要用 ==。', 'int 大约能表示正负 21 亿，超出就回绕成负数——2147483647 + 1 的结果是负的。'],
    deeper: [{ title: '变量在内存里长什么样', text: '一个 int 占 4 个字节。赋值是把右边的值按类型编码成字节写进这段内存，读取时再按同样的类型解释回来。右侧面板显示的值就是这串字节的翻译结果。' }, { title: '类型决定解释方式', text: '同样 4 个字节，按 int 读是整数，按 float 读就是完全不同的数。类型写错时字节不会变，变的是解释方式——很多诡异的 bug 都源于此。' }],
    challenge: '把 a 的初值改成 12，预测 b 的结果，再运行验证。', prediction: 'a 变成 7 后，b 会跟着变成 7 吗？', answer: '不会。b 已经取得当时 a 的值 3，后续修改 a 不改变 b。',
    code: '#include <stdio.h>\n\nint main() {\n    int a = 3;\n    int b = 0;\n    b = a;\n    a = 7;\n    printf("a = %d, b = %d\\n", a, b);\n    return 0;\n}\n', input: '', expected: 'a = 7, b = 3\n',
  },
  {
    id: 'conditions', number: '03', title: '判断与分支', subtitle: '不同条件，走不同的路', group: '控制流程', time: '15 分钟', tags: ['if / else', '比较', '边界'],
    intro: '程序通过条件做选择。用一个刚好在边界附近的成绩，观察判断如何改变结果。',
    concepts: [{ title: '条件决定路径', text: 'if 的条件非零时进入对应分支；否则进入 else。没有被选中的分支不会执行。' }, { title: '注意相等的情况', text: '>= 与 > 在边界值的表现不同。测试 59、60 和 61，比只测试一个普通值更有帮助。' }],
    pitfalls: ['把 == 写成 =：if (a = 0) 是先赋值再判断，条件永远不成立，编译器只给一个警告。', '悬空 else：else 总是和最近的 if 配对，嵌套判断时用花括号把层次写清楚。', '浮点数别用 == 比较：0.1 加 0.2 并不精确等于 0.3，判断相等要留误差或干脆用整数。'],
    deeper: [{ title: '条件其实就是整数', text: 'C 里 0 是假、非 0 都是真，所以 if (n) 等价于 if (n != 0)。这也是 while (scanf(...) == 1) 这类写法能成立的原因。' }, { title: '短路求值', text: '&& 和 || 一旦能确定结果就不再计算后面。写成 age >= 0 && age <= 120，前一半不成立时后一半不会执行，还能顺手防止数组越界。' }],
    challenge: '把 score 依次改为 59、60 和 61，观察 passed。再把 >= 改成 >。', prediction: 'score 等于 60 时，passed 是多少？', answer: '是 1。60 >= 60 成立，程序进入通过分支。',
    code: '#include <stdio.h>\n\nint main() {\n    int score = 60;\n    int passed = 0;\n    if (score >= 60) {\n        passed = 1;\n        printf("Passed\\n");\n    } else {\n        printf("Try again\\n");\n    }\n    printf("passed = %d\\n", passed);\n    return 0;\n}\n', input: '', expected: 'Passed\npassed = 1\n',
  },
  {
    id: 'loops', number: '04', title: '循环的节奏', subtitle: '初始化、判断、执行、更新', group: '控制流程', time: '20 分钟', tags: ['for', '循环变量', '累加'],
    intro: '让同一段代码重复执行。跟着 i 的变化，分清循环开始、继续和结束的时刻。',
    concepts: [{ title: '四个阶段', text: 'for 先初始化，再判断条件。条件成立时执行循环体，然后更新变量，再回到判断。' }, { title: '总和需要保留', text: 'sum 在循环外初始化。如果每轮重新设为 0，就无法累积此前的结果。' }],
    pitfalls: ['累加变量忘了在循环外初始化，每轮加的都是不确定的值。', '边界差一：i < n 遍历 n 次，i <= n 会多跑一次，想清楚从 0 还是从 1 开始。', '在循环体里随手修改 i，轮数就会和预想对不上，界面里的「第几轮」会立刻暴露问题。'],
    deeper: [{ title: 'for 就是紧凑的 while', text: 'for (A; B; C) 完全等价于先执行 A，然后「当 B 成立就执行循环体和 C」。三个部分都能留空，for (;;) 就是一个不主动停的循环。' }, { title: '找到不变量', text: '想清楚「每轮结束后什么关系成立」，例如「total 永远等于前 i 个元素之和」。能说出不变量，循环几乎不会写错，这也是检查别人循环最快的方法。' }],
    challenge: '把 i <= 5 改成 i < 5。少执行了哪一次？总和会少多少？', prediction: '1 加到 5 的结果是多少？', answer: '15。sum 依次变成 1、3、6、10、15。',
    code: '#include <stdio.h>\n\nint main() {\n    int sum = 0;\n    for (int i = 1; i <= 5; i++) {\n        sum = sum + i;\n    }\n    printf("sum = %d\\n", sum);\n    return 0;\n}\n', input: '', expected: 'sum = 15\n',
  },
  {
    id: 'arrays', number: '05', title: '数组与遍历', subtitle: '一组数据，一步一步看清', group: '数据与函数', time: '20 分钟', tags: ['数组', '索引', 'for 循环'],
    intro: '数组把同类型的数据按顺序放在一起。这一课，用循环走过每个成绩，观察总和怎样产生。',
    concepts: [{ title: '从 0 开始的索引', text: 'scores 有 5 个元素，有效索引是 0 到 4。scores[2] 取得第三个元素，而不是数值 2。' }, { title: '数组与循环配合', text: '每轮使用 i 访问一个元素，再把该值加到 sum。i < 5 保证本例不访问第 5 个索引。' }],
    pitfalls: ['C 不检查下标：长度 5 的数组写 a[5] 不报错，但读写的已经是别人的内存，界面会标注越界。', '数组长度必须是编译期常量；写成 int a[n] 这类变长数组会被明确拒绝。', '遍历条件写 i <= n 会多走一格，习惯写 i < n，从 0 开始到 n-1 结束。'],
    deeper: [{ title: 'a[i] 到底是什么', text: '数组是连续的字节，a[i] 的地址等于数组首地址加上 i 乘以单个元素的字节数。界面里的索引游标画的就是这个计算，理解它之后指针访问数组也就通了。' }, { title: '数组名会退化', text: '把数组传给函数时，传过去的其实是首元素地址，函数内部拿不到长度，所以总要额外传一个 n。第 08 课指针会展开这一点。' }],
    challenge: '把第一个成绩 72 改成 100。先预测总和的变化，再重新运行。', prediction: '五个成绩的总和是多少？', answer: '420。72 + 85 + 93 + 68 + 102 = 420。试着修改某个元素，检查变化是否符合预测。',
    code: '#include <stdio.h>\n\nint main() {\n    int scores[5] = {72, 85, 93, 68, 102};\n    int sum = 0;\n\n    for (int i = 0; i < 5; i++) {\n        sum = sum + scores[i];\n    }\n\n    printf("Total: %d\\n", sum);\n    return 0;\n}\n', input: '', expected: 'Total: 420\n',
  },
  {
    id: 'functions', number: '06', title: '函数与传值', subtitle: '把一个任务交给一个函数', group: '数据与函数', time: '20 分钟', tags: ['函数', '形参', '返回值'],
    intro: '函数接收参数、执行任务并返回结果。观察新的调用层，区分调用者的变量与函数里的参数。',
    concepts: [{ title: '参数是值的副本', text: '调用 add(x, y) 时，a 和 b 接收 x 和 y 的值。它们是独立变量。' }, { title: '返回结果', text: 'return 把结果交回调用者。函数结束后，它的局部变量不再处于活动作用域。' }],
    pitfalls: ['以为修改形参就能影响调用者的变量：传值是复制副本，改的只是副本。', '函数里算出的结果忘了 return，或者调用了却没接收，结果就白白丢掉。', '返回局部变量的地址：函数一结束那块内存就作废了，指针指向垃圾数据。'],
    deeper: [{ title: '栈帧的一生', text: '每次调用，程序在栈上分配一块空间存放这次调用的参数和局部变量，return 时整块回收。右侧的「函数调用」面板展示的就是这条栈，能看到每个变量属于哪一层。' }, { title: '想修改调用者的变量怎么办', text: '把变量的地址传进去，函数通过 *p 间接读写。这正是第 08 课指针要解决的问题，也是 scanf 参数前必须写 & 的原因。' }],
    challenge: '在 add 中给 a 加上 10。调用结束后，main 中的 x 是否也改变了？', prediction: 'add 返回后，result 和 x 各是多少？', answer: 'result 是 7，x 仍是 5。函数通过返回值把结果带回来。',
    code: '#include <stdio.h>\n\nint add(int a, int b) {\n    int total = a + b;\n    return total;\n}\n\nint main() {\n    int x = 5;\n    int y = 2;\n    int result = add(x, y);\n    printf("result = %d, x = %d\\n", result, x);\n    return 0;\n}\n', input: '', expected: 'result = 7, x = 5\n',
  },
  {
    id: 'strings', number: '07', title: '字符与字符串', subtitle: '看见字符串最后的终止符', group: '数据与函数', time: '15 分钟', tags: ['char', '\\0', '字符串'],
    intro: '字符串是以空字符结束的字符序列。数组容量与字符串长度，是两个不同的概念。',
    concepts: [{ title: '字符也是数组元素', text: 'char word[6] = "Hello" 保存五个字符和一个终止符。界面会把不可见的终止符显示为 \\0。' }, { title: '到终止符为止', text: '打印字符串时，\\0 表示结束，不会作为普通字符输出。字符数组不是总能当字符串使用。' }],
    pitfalls: ['忘了给 \0 留位置：char name[5] 只装得下 4 个字符加一个终止符。', 'strlen 数的是到终止符为止的字符数，sizeof 是数组总字节数，两者经常不相等。', 'scanf 用 %s 读字符串没有宽度限制，输入超长就写越界；写成 %9s 限制最多 9 个字符。'],
    deeper: [{ title: '字符串是一个约定', text: 'C 没有字符串类型，所谓字符串就是以 \0 结尾的 char 数组。strlen、strcmp 这些函数全靠这个约定工作，忘了 \0 它们会一路读到内存深处。' }, { title: '一个汉字占几格', text: 'UTF-8 编码下常用汉字占 3 个字节，在 char 数组里就是连续 3 格。界面会把它们分开显示；整体 printf 输出没问题，逐字符处理时要小心。' }],
    challenge: '把 word[0] 改成另一个字符，观察数组格和最终输出。', prediction: '数组有 6 格，为什么只打印 5 个字符？', answer: '第六格是终止符 \\0。它占一个元素，但不是要打印的文本。',
    code: '#include <stdio.h>\n\nint main() {\n    char word[6] = "Hello";\n    word[0] = \'h\';\n    printf("%s\\n", word);\n    return 0;\n}\n', input: '', expected: 'hello\n',
  },
  {
    id: 'pointers', number: '08', title: '指针初体验', subtitle: '改指向，还是改目标的值？', group: '深入一步', time: '25 分钟', tags: ['& 取址', '* 解引用', '指针'],
    intro: '指针帮助我们找到另一个对象。观察箭头：修改 p 改变目标，修改 *p 改变目标里保存的值。',
    concepts: [{ title: '取址与指向', text: '&x 取得 x 的地址。这里用箭头表达指向关系，不显示虚构的机器地址。' }, { title: '通过指针修改', text: '*p = 7 修改 p 指向的对象。p = &y 则只改变 p 的指向，原来的 x 不会被自动修改。' }],
    pitfalls: ['声明里的 * 和表达式里的 * 不是一回事：int *p 说「p 是指针」，*p 表示「p 指向的那一格」。', '野指针：没赋初值就对 *p 读写，指向不明，属于未定义行为；声明时先置 NULL。', '想通过函数交换两个变量，传值做不到；要传地址，函数里用 * 间接交换。'],
    deeper: [{ title: '指针就是地址值', text: '指针变量的值是另一个对象的位置。& 取地址，* 按地址读写。界面里的箭头画的是逻辑指向关系，不是真实内存地址——真实地址每次运行都可能不同。' }, { title: 'NULL 是有意义的空', text: '「现在不指向任何对象」也需要能表达，这就是 NULL。使用前先判断 if (p != NULL) 是好习惯，第 22 课检查 malloc 返回值用的就是它。' }],
    challenge: '在 p = &y 之前增加一次 *p = 20。哪个变量会改变？', prediction: '最终 x 和 y 分别是多少？', answer: 'x 是 7，y 是 11。先通过 p 修改 x，再改变 p 的指向并修改 y。',
    code: '#include <stdio.h>\n\nint main() {\n    int x = 5;\n    int y = 9;\n    int *p = &x;\n    *p = 7;\n    p = &y;\n    *p = 11;\n    printf("x = %d, y = %d\\n", x, y);\n    return 0;\n}\n', input: '', expected: 'x = 7, y = 11\n',
  },
  {
    id: 'input', number: '09', title: '输入与交互', subtitle: '同一段程序，接收不同的数据', group: '深入一步', time: '15 分钟', tags: ['scanf', '标准输入', '计算'],
    intro: '在下方的输入面板提前填写数据，再运行程序。scanf 从这段输入中读取并保存数值。',
    concepts: [{ title: '先提供输入', text: '本版使用预设标准输入。把两个整数用空格或换行分隔，运行时依次读取。' }, { title: '为什么使用 &', text: 'scanf 需要知道把读到的数据保存到哪里，因此给它变量的地址，并检查成功读取的数量。' }],
    pitfalls: ['变量前忘写 &：scanf("%d", n) 会把输入写到 n 的地址上，少了 & 就写到别处去了。', '不看返回值：scanf 返回成功读取的个数，用它才能判断用户是不是真的输入了数字。', '数字后面用 %c 读字符时，残留的换行会被当成「一个字符」读走；用 %s 或先清理缓冲区。'],
    deeper: [{ title: '输入缓冲区', text: '键盘输入先进入缓冲区，scanf 从里面按格式取数。提示语和输入的先后、回车残留带来的怪现象，根源都在缓冲区。fgets 按「行」读取，连换行一起拿到，更适合读一句话。' }, { title: '从演示到工具', text: '把「输入 → 计算 → 输出」连成闭环，程序就从固定剧本变成能响应不同数据的工具。预设输入框可以反复修改数值做实验。' }],
    challenge: '在「输入」中换成 18 24，再次运行，查看两个变量与输出。', prediction: '输入 12 8，程序会得到什么结果？', answer: 'a=12、b=8，相加得到 20。修改输入不需要修改源码。',
    code: '#include <stdio.h>\n\nint main() {\n    int a = 0;\n    int b = 0;\n    int count = scanf("%d %d", &a, &b);\n    if (count == 2) {\n        int total = a + b;\n        printf("sum = %d\\n", total);\n    } else {\n        printf("Please enter two integers.\\n");\n    }\n    return 0;\n}\n', input: '12 8', expected: 'sum = 20\n',
  },
  {
    id: 'while', number: '10', title: 'while 与循环控制', subtitle: '知道何时继续，也知道何时停下', group: '深入一步', time: '20 分钟', tags: ['while', 'break', 'continue'],
    intro: 'while 在每轮开始前判断条件。用 continue 跳过本轮后续操作，用 break 离开整个循环。',
    concepts: [{ title: 'continue 不是结束循环', text: 'continue 回到 while 的条件判断。确保循环变量能够更新，否则可能永远停不下来。' }, { title: 'break 直接离开', text: '当满足停止条件时，break 跳出当前循环，继续执行循环后的语句。' }],
    pitfalls: ['循环体里忘记更新条件变量：while (i < 10) 没有 i++ 就是死循环，执行器会提示步数超限。', 'break 只跳出最近的一层循环或 switch，嵌套循环想全部跳出要另想办法。', 'while 里把更新语句写在 continue 之后，continue 一触发就永远轮不到更新，同样死循环。'],
    deeper: [{ title: '什么时候用 while', text: '循环次数由「事件」决定（找到目标、读完输入）用 while；由「数字」决定（跑 10 轮）用 for。第 23 课的主循环按命令运转，用的就是 while。' }, { title: '哨兵值', text: '用一个约定好的特殊值表示结束（例如输入 0 退出），条件写成「还没遇到哨兵」。第 23 课输入 0 退出系统，用的就是这个模式。' }],
    challenge: '移除跳过偶数的判断，预测输出将增加哪些数字。', prediction: '这个程序最终打印哪些数字？', answer: '1、3、5。偶数被跳过，i 大于 5 时退出。',
    code: '#include <stdio.h>\n\nint main() {\n    int i = 0;\n    while (i < 10) {\n        i++;\n        if (i > 5) {\n            break;\n        }\n        if (i % 2 == 0) {\n            continue;\n        }\n        printf("%d\\n", i);\n    }\n    return 0;\n}\n', input: '', expected: '1\n3\n5\n',
  },
  {
    id: 'struct', number: '11', title: '结构体', subtitle: '把同一件事的属性放在一起', group: '组织数据', time: '25 分钟', tags: ['struct', '字段', '. 与 ->'],
    intro: '结构体把属于同一个对象的字段组合在一起。右侧会显示每个字段的值，以及它占用的字节偏移。',
    concepts: [{ title: '字段各有位置', text: '字段按声明顺序排列，并按对齐要求补空隙。所以字段大小之和不一定等于结构体大小。' }, { title: '点号与箭头', text: 's.score 用点号访问结构体变量；p->score 用箭头访问结构体指针，两者是同一件事的两种写法。' }],
    pitfalls: ['struct 定义末尾的分号漏掉，报错却出现在很远的地方，先检查这里。', '两个结构体变量不能用 == 比较，C 没定义这个运算，要逐字段比较。', '字段顺序影响 sizeof：对齐产生的「缝隙」也算字节，界面里的偏移量就是真实布局。'],
    deeper: [{ title: '偏移量与对齐', text: '为了让 CPU 读取更快，int 字段会对齐到 4 的倍数地址，字段之间可能留空隙。面板里每个字段前的 +0、+4 就是真实偏移，sizeof 也因此可能大于字段大小之和。' }, { title: '按值赋值是整块复制', text: 's2 = s1 会把结构体的全部字节复制过去，之后两者各自独立、互不影响。想让两个名字操作同一份数据，就需要下一课的结构体指针。' }],
    challenge: '调整 struct Mixed 的字段顺序，观察总大小是否变化。', prediction: '一个含 char、int、char 的结构体占多少字节？', answer: '12 字节。int 需要 4 字节对齐，末尾还要补齐，所以不是 6。',
    code: '#include <stdio.h>\n\nstruct Mixed { char tag; int score; char level; };\n\nint main() {\n    struct Mixed s;\n    s.tag = \'A\';\n    s.score = 90;\n    s.level = \'B\';\n\n    printf("%c %d %c %d bytes\\n", s.tag, s.score, s.level, (int)sizeof(struct Mixed));\n    return 0;\n}\n', input: '', expected: 'A 90 B 12 bytes\n',
  },
  {
    id: 'struct-pointer', number: '12', title: '结构体指针', subtitle: '通过指向来修改原对象', group: '组织数据', time: '25 分钟', tags: ['指针', '->', '传值与传地址'],
    intro: '把结构体的地址传给函数，函数里的修改会影响调用者的对象。对比传值和传指针的区别。',
    concepts: [{ title: '传值复制一份', text: 'bump_by_value(s, 100) 把整个结构体复制进形参，改形参不影响 s。' }, { title: '传指针共享同一个对象', text: 'bump(&s, 7) 传的是地址，形参与 s 指向同一块内存，所以修改会留下来。' }],
    pitfalls: ['. 和 -> 用混：指针用 ->，结构体变量用 .；p->score 是 (*p).score 的简写。', '通过指针修改字段会直接影响原数据——这通常正是目的，但要清楚它发生了。', '对 NULL 指针使用 -> 会让程序崩溃，先判断非空再使用。'],
    deeper: [{ title: '为什么传指针', text: '大结构体按值传参要复制全部字节；传指针只复制 8 字节地址，还允许函数修改原数据。第 23 课的函数参数 Student * 就是这个用法。' }, { title: '箭头背后的两步', text: 'p->name 先按地址找到结构体，再按第 11 课的偏移量定位 name 字段。偏移来自结构体布局，两课的知识在这里合流。' }],
    challenge: '把 bump(&s, 7) 改成 bump(s, 7)，再预测输出。', prediction: '通过指针加 7 之后，s.score 是多少？', answer: '97。如果改成传值，函数里的加法不会影响 s.score。',
    code: '#include <stdio.h>\n\nstruct Student { int id; int score; };\n\nvoid bump_by_value(struct Student s, int by) {\n    s.score = s.score + by;\n}\n\nvoid bump(struct Student *p, int by) {\n    p->score = p->score + by;\n}\n\nint main() {\n    struct Student s;\n    s.id = 1;\n    s.score = 90;\n\n    bump_by_value(s, 100);\n    printf("after by value: %d\\n", s.score);\n\n    bump(&s, 7);\n    printf("after by pointer: %d\\n", s.score);\n    return 0;\n}\n', input: '', expected: 'after by value: 90\nafter by pointer: 97\n',
  },
  {
    id: 'enum', number: '13', title: '枚举与状态', subtitle: '给数字起名字，让意图可见', group: '组织数据', time: '20 分钟', tags: ['enum', '常量', '状态'],
    intro: '枚举把一串整数常量用名字表示。名字比 0、1、2 更容易读，拼错时更容易被发现。',
    concepts: [{ title: '枚举常量是编译期常量', text: 'EDITING 就是 1，它不是变量，程序里改不了它。' }, { title: '可以显式指定数值', text: '不写就按顺序递增，也可以像 C = 10 这样指定，后续常量从这里继续。' }],
    pitfalls: ['枚举常量的本质是 int，用 %d 打印；想当字符串用会编译失败。', '给枚举变量赋一个列表之外的整数，C 不会拦你，纪律要靠命名和 switch 保证。', '显式指定过值的常量之后，后续常量从那里继续加 1，并不是都从 0 数起。'],
    deeper: [{ title: '用名字替代魔法数字', text: 'if (state == 1) 里的 1 是什么意思？换成 if (state == EDITING)，代码自己会说话。枚举的本质是一组有名字的整型常量。' }, { title: '枚举配 switch', text: 'switch (state) 把所有状态列出来，漏写分支一目了然。第 23 课的 Result 枚举就是靠它把 OK / DUPLICATE / NOT_FOUND 分得清清楚楚。' }],
    challenge: '把 EDITING 改成 EDITING = 2，观察 SAVED 变成多少。', prediction: 'IDLE、EDITING、SAVED 的值依次是什么？', answer: '0、1、2。第一个常量从 0 开始，之后每个加 1。',
    code: '#include <stdio.h>\n\nenum State { IDLE, EDITING, SAVED };\n\nint main() {\n    enum State s = EDITING;\n\n    printf("current = %d\\n", (int)s);\n    if (s == EDITING) {\n        printf("not saved yet\\n");\n    }\n\n    s = SAVED;\n    printf("now = %d\\n", (int)s);\n    return 0;\n}\n', input: '', expected: 'current = 1\nnot saved yet\nnow = 2\n',
  },
  {
    id: 'callback', number: '14', title: '回调：把规则交给调用者', subtitle: '同一段流程，不同的比较规则', group: '组织数据', time: '30 分钟', tags: ['函数指针', '回调', '解耦'],
    intro: '排序流程不需要知道按什么排。把「怎么比较」作为一个函数传进去，同一段流程就能服务不同的规则。',
    concepts: [{ title: '函数可以当值传递', text: 'int (*less)(int,int) 是函数指针类型：指向「接收两个 int、返回 int」的函数。' }, { title: '流程不变，规则可换', text: 'sort3 不知道自己被用来升序还是降序，它只在需要比较时调用传进来的函数。' }],
    pitfalls: ['函数指针类型写法：int (*less)(int, int) 的括号不能省，省了就变成「返回指针的函数」。', '传函数时不加括号：传 asc 是传函数本身，写成 asc() 传的是调用结果。', '回调函数的参数与返回类型必须和指针签名一致，错一个类型就运行不对。'],
    deeper: [{ title: '流程与规则分离', text: 'sort3 只负责比较的流程，asc / desc 负责比较的规则。改规则不动流程——C 标准库的 qsort 就是这个用法，也是「策略模式」的雏形。' }, { title: '真实世界的回调', text: '按钮点击处理、排序比较器、日志钩子，本质都是把函数当参数传给别人的流程。第 18 课会把它升级成跨文件的策略接口。' }],
    challenge: '把 sort3(a, 3, asc) 改成 desc，预测输出顺序。', prediction: '升序和降序分别得到什么顺序？', answer: '升序是 10 20 30，降序是 30 20 10。两次调用的是同一个排序函数。',
    code: '#include <stdio.h>\n\nvoid sort3(int *a, int n, int (*less)(int, int)) {\n    for (int i = 0; i < n; i++) {\n        for (int j = i + 1; j < n; j++) {\n            if (less(a[j], a[i])) {\n                int t = a[i];\n                a[i] = a[j];\n                a[j] = t;\n            }\n        }\n    }\n}\n\nint asc(int x, int y) { return x < y; }\nint desc(int x, int y) { return x > y; }\n\nint main() {\n    int a[3] = {30, 10, 20};\n\n    sort3(a, 3, asc);\n    printf("asc : %d %d %d\\n", a[0], a[1], a[2]);\n\n    sort3(a, 3, desc);\n    printf("desc: %d %d %d\\n", a[0], a[1], a[2]);\n    return 0;\n}\n', input: '', expected: 'asc : 10 20 30\ndesc: 30 20 10\n',
  },
  ...architectureLessons,
  ...advancedLessons,
];
