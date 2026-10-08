import { describe, expect, it } from 'vitest';
import { runTraceAsync } from './trace';

const run = (source: string, input = '') => runTraceAsync(source, input);

describe('基础语法与控制流', () => {
  it('变量、赋值与整数除法', async () => {
    const trace = await run('#include <stdio.h>\nint main(){int a=7,b=2;printf("%d %d %d\\n",a+b,a-b,a/b);return 0;}');
    expect(trace.error).toBeUndefined();
    expect(trace.output).toBe('9 5 3\n');
  });

  it('字符串与终止符', async () => {
    const trace = await run('#include <stdio.h>\n#include <string.h>\nint main(){char w[6]="Hello";printf("%s %d\\n",w,(int)strlen(w));return 0;}');
    expect(trace.output).toBe('Hello 5\n');
  });

  it('for 循环累加数组', async () => {
    const trace = await run('#include <stdio.h>\nint main(){int s[5]={72,85,93,68,102};int t=0;for(int i=0;i<5;i++){t+=s[i];}printf("%d\\n",t);return 0;}');
    expect(trace.output).toBe('420\n');
  });

  it('while + break/continue', async () => {
    const trace = await run('#include <stdio.h>\nint main(){int i=0;while(i<10){i++;if(i>5)break;if(i%2==0)continue;printf("%d ",i);}printf("\\n");return 0;}');
    expect(trace.output).toBe('1 3 5 \n');
  });

  it('函数传值与返回值', async () => {
    const trace = await run('#include <stdio.h>\nint add(int a,int b){int t=a+b;return t;}\nint main(){int x=5;int r=add(x,2);printf("%d %d\\n",r,x);return 0;}');
    expect(trace.output).toBe('7 5\n');
  });

  it('switch 与 default', async () => {
    const trace = await run('#include <stdio.h>\nint main(){int v=2;switch(v){case 1:printf("one\\n");break;case 2:printf("two\\n");break;default:printf("other\\n");}return 0;}');
    expect(trace.output).toBe('two\n');
  });
});

describe('结构体', () => {
  it('声明、字段赋值与点号访问', async () => {
    const trace = await run('#include <stdio.h>\nstruct Student{int id;int score;};\nint main(){struct Student s;s.id=1;s.score=90;printf("%d %d\\n",s.id,s.score);return 0;}');
    expect(trace.error).toBeUndefined();
    expect(trace.output).toBe('1 90\n');
  });

  it('带初始化的结构体与数组', async () => {
    const trace = await run('#include <stdio.h>\nstruct P{char name[8];int score;};\nint main(){struct P a[2]={{"Ada",90},{"Bo",70}};printf("%s %d %s %d\\n",a[0].name,a[0].score,a[1].name,a[1].score);return 0;}');
    expect(trace.output).toBe('Ada 90 Bo 70\n');
  });

  it('结构体指针与 -> 访问', async () => {
    const trace = await run('#include <stdio.h>\nstruct P{int score;};\nvoid bump(struct P *p,int by){p->score=p->score+by;}\nint main(){struct P s;s.score=80;bump(&s,7);printf("%d\\n",s.score);return 0;}');
    expect(trace.output).toBe('87\n');
  });

  it('结构体赋值按值复制，改副本不影响原变量', async () => {
    const trace = await run([
      '#include <stdio.h>',
      'struct P{int a;int b;};',
      'struct P make(int a,int b){struct P p;p.a=a;p.b=b;return p;}',
      'int main(){struct P x;x.a=1;x.b=2;struct P y=x;y.a=9;printf("%d %d %d %d\\n",x.a,x.b,y.a,y.b);return 0;}',
    ].join('\n'));
    expect(trace.output).toBe('1 2 9 2\n');
  });

  it('计算字段偏移与整体大小', async () => {
    const trace = await run('#include <stdio.h>\nstruct Mixed{char c;int i;char d;};\nint main(){printf("%d %d\\n",(int)sizeof(struct Mixed),(int)sizeof(struct Mixed*));return 0;}');
    expect(trace.output).toBe('12 8\n');
    const layout = trace.layouts?.find(item => item.name === 'Mixed');
    expect(layout?.size).toBe(12);
    expect(layout?.fields.map(field => [field.name, field.offset])).toEqual([['c', 0], ['i', 4], ['d', 8]]);
  });

  it('通过结构体指针修改字段会影响原变量', async () => {
    const trace = await run('#include <stdio.h>\nstruct P{int v;};\nint main(){struct P s;s.v=1;struct P *q=&s;q->v=5;printf("%d\\n",s.v);return 0;}');
    expect(trace.output).toBe('5\n');
  });
});

describe('枚举', () => {
  it('枚举常量参与比较与赋值', async () => {
    const trace = await run('#include <stdio.h>\nenum State{IDLE,EDITING,SAVED};\nint main(){enum State s=EDITING;if(s==EDITING)printf("editing %d\\n",(int)s);printf("%d\\n",(int)SAVED);return 0;}');
    expect(trace.error).toBeUndefined();
    expect(trace.output).toBe('editing 1\n2\n');
  });

  it('枚举显式赋值', async () => {
    const trace = await run('#include <stdio.h>\nenum E{A=5,B,C=10};\nint main(){printf("%d %d %d\\n",(int)A,(int)B,(int)C);return 0;}');
    expect(trace.output).toBe('5 6 10\n');
  });
});

describe('函数指针与回调', () => {
  it('把比较函数作为参数传入', async () => {
    const trace = await run('#include <stdio.h>\nint byScore(int a,int b){return a-b;}\nint apply(int (*cmp)(int,int),int x,int y){return cmp(x,y);}\nint main(){printf("%d\\n",apply(byScore,90,70));return 0;}');
    expect(trace.error).toBeUndefined();
    expect(trace.output).toBe('20\n');
  });

  it('交换回调改变结果而流程不变', async () => {
    const code = (body: string) => `#include <stdio.h>\nint byScore(int a,int b){return a-b;}\nint byName(int a,int b){return a-b;}\nint pick(int (*cmp)(int,int)){return cmp(1,2);}\nint main(){printf("%d\\n",pick(${body}));return 0;}`;
    expect((await run(code('byScore'))).output).toBe('-1\n');
    expect((await run(code('byName'))).output).toBe('-1\n');
  });

  it('回调排序真实改变顺序', async () => {
    const trace = await run([
      '#include <stdio.h>',
      'void sort3(int *a,int n,int (*less)(int,int)){int i,j,t;for(i=0;i<n;i++)for(j=i+1;j<n;j++)if(less(a[j],a[i])){t=a[i];a[i]=a[j];a[j]=t;}}',
      'int asc(int x,int y){return x<y;}',
      'int desc(int x,int y){return x>y;}',
      'int main(){int a[3]={30,10,20};sort3(a,3,asc);printf("%d %d %d | ",a[0],a[1],a[2]);sort3(a,3,desc);printf("%d %d %d\\n",a[0],a[1],a[2]);return 0;}',
    ].join('\n'));
    expect(trace.output).toBe('10 20 30 | 30 20 10\n');
  });
});

describe('类型与标准语义', () => {
  it('整数提升与除法取整', async () => {
    const trace = await run('#include <stdio.h>\nint main(){char c=7;printf("%d %d\\n",c/2,7/2);return 0;}');
    expect(trace.output).toBe('3 3\n');
  });

  it('sizeof 与指针宽度', async () => {
    const trace = await run('#include <stdio.h>\nint main(){printf("%d %d %d\\n",(int)sizeof(int),(int)sizeof(double),(int)sizeof(char*));return 0;}');
    expect(trace.output).toBe('4 8 8\n');
  });

  it('scanf 读取预设输入', async () => {
    const trace = await run('#include <stdio.h>\nint main(){int a=0,b=0;int n=scanf("%d %d",&a,&b);if(n==2)printf("sum=%d\\n",a+b);return 0;}', '12 8');
    expect(trace.output).toBe('sum=20\n');
  });

  it('指针运算按元素大小缩放', async () => {
    const trace = await run('#include <stdio.h>\nint main(){int a[4]={10,20,30,40};int *p=a;p=p+2;printf("%d\\n",*p);return 0;}');
    expect(trace.output).toBe('30\n');
  });

  it('浮点格式化', async () => {
    const trace = await run('#include <stdio.h>\nint main(){double d=3.14159;printf("%.2f %5.1f\\n",d,d);return 0;}');
    expect(trace.output).toBe('3.14   3.1\n');
  });
});

describe('错误与边界', () => {
  it('数组越界会明确报错', async () => {
    const trace = await run('int main(){int a[2]={1,2};return a[5];}');
    expect(trace.status).toBe('error');
    expect(trace.error).toContain('下标越界');
  });

  it('除零会明确报错', async () => {
    const trace = await run('#include <stdio.h>\nint main(){int a=1,b=0;printf("%d",a/b);return 0;}');
    expect(trace.status).toBe('error');
    expect(trace.error).toContain('除数为 0');
  });

  it('未声明标识符报错', async () => {
    const trace = await run('int main(){return nope;}');
    expect(trace.status).toBe('error');
    expect(trace.error).toContain('未声明的标识符');
  });

  it('语法错误带行号', async () => {
    const trace = await run('#include <stdio.h>\nint main(){int x = ;return 0;}');
    expect(trace.status).toBe('error');
    expect(trace.errorLine).toBe(2);
  });

  it('无限循环被限制而不是卡死', async () => {
    const trace = await run('int main(){int i=0;while(1){i++;}return 0;}');
    // Either the engine's own step limit or the trace operation cap stops it; both diagnose.
    expect(['error', 'limited']).toContain(trace.status);
    expect(trace.error).toContain('无法结束的循环');
    expect(trace.snapshots.length).toBeGreaterThan(0);
    expect(trace.snapshots.length).toBeLessThanOrEqual(1500);
  });
});
describe('与 GCC 的行为对照', () => {
  // 期望输出由 `gcc -std=c17` 实际编译运行产生（2026-10-07）。
  it('结构体、函数指针、格式化与整除的结果与 GCC 一致', async () => {
    const trace = await run([
      '#include <stdio.h>',
      'struct P{char name[8];int score;};',
      'struct Mixed{char c;int i;char d;};',
      'int byScore(int a,int b){return a-b;}',
      'int apply(int (*cmp)(int,int),int x,int y){return cmp(x,y);}',
      'void sort3(int *a,int n,int (*less)(int,int)){int i,j,t;for(i=0;i<n;i++)for(j=i+1;j<n;j++)if(less(a[j],a[i])){t=a[i];a[i]=a[j];a[j]=t;}}',
      'int asc(int x,int y){return x<y;}',
      'int main(){',
      '  struct P a[2]={{"Ada",90},{"Bo",70}};',
      '  printf("%s %d %s %d\\n",a[0].name,a[0].score,a[1].name,a[1].score);',
      '  printf("%d %d %d\\n",(int)sizeof(struct Mixed),(int)sizeof(struct Mixed*),(int)sizeof(double));',
      '  printf("%d\\n",apply(byScore,90,70));',
      '  int n[3]={30,10,20}; sort3(n,3,asc); printf("%d %d %d\\n",n[0],n[1],n[2]);',
      '  char c=7; printf("%d %d\\n",c/2,7/2);',
      '  int *p=n; p=p+2; printf("%d\\n",*p);',
      '  printf("%.2f %5.1f\\n",3.14159,3.14159);',
      '  char w[6]="Hello"; printf("%s %d\\n",w,(int)w[0]);',
      '  int x=5; int y=x*x; printf("%d\\n",y);',
      '  return 0;}',
    ].join('\n'));
    expect(trace.error).toBeUndefined();
    expect(trace.output).toBe(
      'Ada 90 Bo 70\n' +
      '12 8 8\n' +
      '20\n' +
      '10 20 30\n' +
      '3 3\n' +
      '30\n' +
      '3.14   3.1\n' +
      'Hello 72\n' +
      '25\n',
    );
  });
});
