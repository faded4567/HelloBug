class TemplateSummary {
  final String id;
  final String label;
  final String content;

  const TemplateSummary({required this.id, required this.label, required this.content});
}

const kDefaultTemplates = [
  TemplateSummary(id: 't1', label: 'git status', content: 'git status'),
  TemplateSummary(id: 't2', label: '跑测试', content: '运行所有测试并报告结果'),
  TemplateSummary(id: 't3', label: '最近提交', content: '查看最近 5 个 git commit'),
  TemplateSummary(id: 't4', label: '列目录', content: 'ls -la'),
];
