import type { Lesson } from './lessons';

const header = (name: string, body: string) => `#ifndef ${name}_H\n#define ${name}_H\n${body}\n#endif\n`;

export const architectureLessons: Lesson[] = [
  {
    id: 'modules', number: '15', title: '从单文件到模块', subtitle: '声明是约定，实现可以独立改变', group: '软件架构 · 可运行的 C 模块', time: '25 分钟', tags: ['.c / .h', '接口', '链接'],
    intro: '把求和逻辑放进 stats.c，用 stats.h 对外声明。main.c 只需要知道函数的约定，不需要复制实现。三个文件参与一次真实的项目执行。',
    concepts: [{ title: '头文件声明，源文件实现', text: '每个 .c 都独立包含 stats.h 并解析。头文件保护避免同一翻译单元重复包含。链接阶段把 main 中的调用与 stats.c 的定义连接起来。' }, { title: '沿调用观察模块边界', text: '逐步执行 sum 时，左侧会切到 stats.c，返回后回到 main.c。右侧同时显示实际调用层和所在文件。包含关系只表示源码依赖，不等于运行时调用。' }],
    prediction: '把 stats.c 中的 result 初值改成 10，需要改 main.c 的调用方式吗？', answer: '不需要。sum 的名字、参数和返回类型没有变，但输出会从 12 变成 22。接口稳定并不意味着行为不会改变。',
    pitfalls: ['头文件忘了写 #ifndef 保护，被包含两次就会重复定义。', '在 .h 里写函数体而不是声明，多个 .c 一包含就冲突。', '调用其他文件的函数前忘了 include 对应头文件，诊断会明确指出缺少声明。'],
    deeper: [{ title: '翻译单元与链接', text: '每个 .c 独立编译、互不知情，链接器再把调用和定义接起来。界面里每一步停点都标注了所在文件，运行时看到的正是这条链路。' }, { title: '接口是最小承诺', text: 'stats.h 只暴露 sum 一个函数，内部变量调用者不知道也不用知道。接口越窄，将来改动越自由——这是模块化的核心回报。' }],
    challenge: '为 stats 模块增加 maximum 函数：在 .h 声明、在 .c 定义、在 main.c 调用。再删除声明，观察诊断。',
    code: '#include <stdio.h>\n#include "stats.h"\n\nint main(void) {\n    int values[3] = {3, 4, 5};\n    int total = sum(values, 3);\n    printf("total = %d\\n", total);\n    return 0;\n}\n',
    files: {
      'stats.h': header('STATS', 'int sum(int *values, int count);'),
      'stats.c': '#include "stats.h"\n\nint sum(int *values, int count) {\n    int result = 0;\n    for (int i = 0; i < count; i++) {\n        result += values[i];\n    }\n    return result;\n}\n',
    }, input: '', expected: 'total = 12\n',
  },
  {
    id: 'encapsulation', number: '16', title: '封装与状态所有权', subtitle: '让模块守住自己的数据规则', group: '软件架构 · 可运行的 C 模块', time: '25 分钟', tags: ['static', 'extern', '封装'],
    intro: '库存由 inventory.c 私有维护，调用者只能通过接口扣减。另一个公开计数器用 extern 共享，比较两种边界的差异。',
    concepts: [{ title: '文件级 static 是边界', text: 'stock 只属于 inventory.c。同名的文件级 static 可以存在于不同 .c 中，彼此独立。调用者不能绕过 reserve 的检查直接修改库存。' }, { title: 'extern 只声明，不复制对象', text: 'requests 在头文件声明，在 inventory.c 唯一定义。main 与库存模块访问的是同一对象。公开可写数据会增加耦合，实际项目可改用只读查询函数。' }],
    prediction: '库存是 5，连续申请 3 和 4，最后库存是负数吗？requests 是多少？', answer: '不是。第二次申请被拒绝，库存仍为 2；requests 记录两次请求，值为 2。',
    pitfalls: ['static 局部变量跨调用保留数值，别以为每次调用都是新变量。', 'extern 公开的变量谁都能改，出问题时排查范围立刻扩大到整个项目。', 'static 不是加密：名字和代码都还在，只是其他翻译单元无权使用。'],
    deeper: [{ title: '信息隐藏的边界', text: 'C 没有 class，.c 文件就是它的封装边界：.h 是对外承诺，static 是私有保险。语言层面把「哪些名字是公开的」固定下来。' }, { title: '只读访问函数', text: '与其公开 extern int requests，不如提供 int request_count(void)。数据只出不进，规则由模块自己执行——第 23 课的 store 模块只暴露查询与插入接口，就是这个思路。' }],
    challenge: '把 requests 改成 static，并提供 request_count() 访问函数。同步修改头文件和 main.c，去掉共享可写变量。',
    code: '#include <stdio.h>\n#include "inventory.h"\n\nint main(void) {\n    int first = reserve(3);\n    int second = reserve(4);\n    printf("accepted = %d %d\\n", first, second);\n    printf("stock = %d, requests = %d\\n", remaining(), requests);\n    return 0;\n}\n',
    files: {
      'inventory.h': header('INVENTORY', 'extern int requests;\nint reserve(int amount);\nint remaining(void);'),
      'inventory.c': '#include "inventory.h"\n\nstatic int stock = 5;\nint requests = 0;\n\nint reserve(int amount) {\n    requests++;\n    if (amount <= 0 || amount > stock) return 0;\n    stock -= amount;\n    return 1;\n}\n\nint remaining(void) {\n    return stock;\n}\n',
    }, input: '', expected: 'accepted = 1 0\nstock = 2, requests = 2\n',
  },
  {
    id: 'layers', number: '17', title: '分层与依赖方向', subtitle: '入口组织流程，业务表达规则，存储提供数据', group: '软件架构 · 可运行的 C 模块', time: '30 分钟', tags: ['分层', '依赖', '职责'],
    intro: 'main.c 负责展示，service.c 负责订单规则，repository.c 负责库存。沿调用层看一笔订单如何逐层传递，再观察失败请求在哪里被拒绝。',
    concepts: [{ title: '每层只承担一种理由的变化', text: '更换输出文字只改 main；修改数量限制只改 service；更换库存实现只改 repository。服务层不调用 printf，存储层不反向依赖服务层。' }, { title: '接口让层次可见', text: 'main 包含 service.h，service 包含 repository.h。头文件箭头描述编译依赖，调用层描述本次实际运行，两者不是同一张图。' }],
    prediction: '购买 2 件后，再购买 5 件，会进入第二次存储扣减吗？', answer: '不会。业务层限制每单不超过 3 件，第二次请求在 service.c 提前返回。库存最后是 6。',
    pitfalls: ['存储层里直接 printf：底层不该决定展示形式，展示是入口层的职责。', '两个模块互相包含对方的头文件形成循环依赖，链接阶段会直接报错。', '所有函数都塞进 main.c：分层不是目录游戏，职责真的要分开。'],
    deeper: [{ title: '依赖只能单向', text: '入口 → 业务 → 存储，箭头不许回头。依赖单向，每层才能独立替换：换掉存储实现，业务层一行不改。界面里「调用所在文件」展示的就是依赖在运行时的样子。' }, { title: '分层的代价与收益', text: '分层要多写几个文件和接口，换来的是改动影响范围可控。衡量标准很朴素：一次需求变更，你需要打开几个文件？' }],
    challenge: '把每单上限从 3 改为 6，比较两次运行的调用层。然后把初始库存改为 4，区分业务拒绝和库存不足。',
    code: '#include <stdio.h>\n#include "service.h"\n\nint main(void) {\n    int first = purchase(2);\n    int second = purchase(5);\n    printf("orders = %d %d\\n", first, second);\n    printf("available = %d\\n", available());\n    return 0;\n}\n',
    files: {
      'service.h': header('SERVICE', 'int purchase(int count);\nint available(void);'),
      'service.c': '#include "service.h"\n#include "repository.h"\n\nint purchase(int count) {\n    if (count <= 0 || count > 3) return 0;\n    return take_stock(count);\n}\n\nint available(void) {\n    return read_stock();\n}\n',
      'repository.h': header('REPOSITORY', 'int take_stock(int count);\nint read_stock(void);'),
      'repository.c': '#include "repository.h"\n\nstatic int stock = 8;\n\nint take_stock(int count) {\n    if (count > stock) return 0;\n    stock -= count;\n    return 1;\n}\n\nint read_stock(void) {\n    return stock;\n}\n',
    }, input: '', expected: 'orders = 1 0\navailable = 6\n',
  },
  {
    id: 'strategy-modules', number: '18', title: '用接口替换策略', subtitle: '把选择留在入口，把算法交给调用者', group: '软件架构 · 可运行的 C 模块', time: '30 分钟', tags: ['函数指针', '依赖注入', '策略'],
    intro: 'checkout.c 只接收一个定价函数，不硬编码折扣规则。main.c 分别注入常规定价与会员定价，观察调用跨越文件边界。',
    concepts: [{ title: '依赖一个函数签名', text: 'PriceRule 是 int 到 int 的函数指针约定。结算模块不包含 rules.h，只依赖 checkout.h 中的约定；新增策略不必修改结算流程。' }, { title: '装配与执行分开', text: 'main 同时知道结算模块和具体规则，负责选择。执行时函数指针仍指向真实实现，逐步进入不同的 .c 文件。' }],
    prediction: '同样的 100 元，用两个策略结算，checkout.c 的代码会变吗？', answer: '不会。第一次通过 regular 返回 100，第二次通过 member 返回 80。变化的是注入的函数地址与实际调用目标。',
    pitfalls: ['回调签名与函数指针类型不匹配时，报错位置往往离真正的问题很远，先对签名。', '策略函数里塞进输入输出等杂事，「纯规则」就变得难以复用和测试。', '装配时传错函数，两个「不同策略」其实是同一个，输出当然一样。'],
    deeper: [{ title: '依赖接口而不是实现', text: 'checkout.c 只认识 PriceRule 这个签名，根本不 include rules.h。新增策略不用改结算流程——这就是「依赖倒置」最小的样子。' }, { title: '装配点要集中', text: '哪个策略、传给谁，集中在 main 里决定。装配点一旦散落到各个文件，很快就没有人能说清谁依赖谁。' }],
    challenge: '新增 student 策略返回原价的 90%，在 rules.h 声明、rules.c 定义并在 main 注入；保持 checkout.c 不变。',
    code: '#include <stdio.h>\n#include "checkout.h"\n#include "rules.h"\n\nint main(void) {\n    int normal = checkout(100, regular);\n    int discounted = checkout(100, member);\n    printf("prices = %d %d\\n", normal, discounted);\n    return 0;\n}\n',
    files: {
      'checkout.h': header('CHECKOUT', 'typedef int (*PriceRule)(int price);\nint checkout(int price, PriceRule rule);'),
      'checkout.c': '#include "checkout.h"\n\nint checkout(int price, PriceRule rule) {\n    int result = rule(price);\n    return result;\n}\n',
      'rules.h': header('RULES', 'int regular(int price);\nint member(int price);'),
      'rules.c': '#include "rules.h"\n\nint regular(int price) {\n    return price;\n}\n\nint member(int price) {\n    return price * 80 / 100;\n}\n',
    }, input: '', expected: 'prices = 100 80\n',
  },
];
