/**
 * 导入导出功能集成测试
 */

import { ExceptionRuleManager } from '../ExceptionRuleManager';
import { ExceptionRuleType } from '../../types';

// Mock localStorage
const localStorageMock = (() => {
  let store: Record<string, string> = {};

  return {
    getItem: (key: string) => store[key] || null,
    setItem: (key: string, value: string) => {
      store[key] = value.toString();
    },
    removeItem: (key: string) => {
      delete store[key];
    },
    clear: () => {
      store = {};
    }
  };
})();

Object.defineProperty(window, 'localStorage', {
  value: localStorageMock
});

describe('导入导出功能集成测试', () => {
  let manager: ExceptionRuleManager;

  beforeEach(() => {
    manager = new ExceptionRuleManager();
    localStorage.clear();
  });

  describe('导出功能', () => {
    test('应该能够导出规则数据', async () => {
      // 创建测试规则
      await manager.createRule('测试规则1', ExceptionRuleType.PAUSE_ONLY, '测试描述1');
      await manager.createRule('测试规则2', ExceptionRuleType.EARLY_COMPLETION_ONLY, '测试描述2');

      // 导出数据
      const exportData = await manager.exportRules(false);

      expect(exportData.rules).toHaveLength(2);
      expect(exportData.rules[0].name).toBe('测试规则1');
      expect(exportData.rules[1].name).toBe('测试规则2');
      expect(exportData.summary.totalRules).toBe(2);
      expect(exportData.exportedAt).toBeInstanceOf(Date);
    });

    test('应该能够导出包含使用数据的规则', async () => {
      // 创建测试规则
      const rule = await manager.createRule('测试规则', ExceptionRuleType.PAUSE_ONLY);
      
      // 模拟使用规则
      const sessionContext = {
        sessionId: 'session_1',
        chainId: 'chain_1',
        chainName: '测试任务',
        startedAt: new Date(),
        elapsedTime: 300,
        remainingTime: 600,
        isDurationless: false
      };
      
      await manager.useRule(rule.rule.id, sessionContext, 'pause');

      // 导出包含使用数据的规则
      const exportData = await manager.exportRules(true);

      expect(exportData.rules).toHaveLength(1);
      expect(exportData.usageRecords).toBeDefined();
      expect(exportData.usageRecords!.length).toBeGreaterThan(0);
      expect(exportData.summary.totalUsageRecords).toBeGreaterThan(0);
    });

    test('应该只导出活跃规则', async () => {
      // 创建规则
      const rule1 = await manager.createRule('活跃规则', ExceptionRuleType.PAUSE_ONLY);
      const rule2 = await manager.createRule('待删除规则', ExceptionRuleType.PAUSE_ONLY);

      // 删除一个规则
      await manager.deleteRule(rule2.rule.id);

      // 导出数据
      const exportData = await manager.exportRules(false);

      expect(exportData.rules).toHaveLength(1);
      expect(exportData.rules[0].name).toBe('活跃规则');
    });
  });

  describe('导入功能', () => {
    test('应该能够导入规则数据', async () => {
      const rulesToImport = [
        {
          name: '导入规则1',
          type: ExceptionRuleType.PAUSE_ONLY,
          description: '导入的规则1'
        },
        {
          name: '导入规则2',
          type: ExceptionRuleType.EARLY_COMPLETION_ONLY,
          description: '导入的规则2'
        }
      ];

      const result = await manager.importRules(rulesToImport);

      expect(result.imported).toHaveLength(2);
      expect(result.skipped).toHaveLength(0);
      expect(result.errors).toHaveLength(0);
      expect(result.imported[0].name).toBe('导入规则1');
      expect(result.imported[1].name).toBe('导入规则2');
    });

    test('应该能够跳过重复规则', async () => {
      // 先创建一个规则
      await manager.createRule('重复规则', ExceptionRuleType.PAUSE_ONLY);

      const rulesToImport = [
        {
          name: '重复规则',
          type: ExceptionRuleType.PAUSE_ONLY,
          description: '这是重复的规则'
        },
        {
          name: '新规则',
          type: ExceptionRuleType.EARLY_COMPLETION_ONLY,
          description: '这是新规则'
        }
      ];

      const result = await manager.importRules(rulesToImport, { skipDuplicates: true });

      expect(result.imported).toHaveLength(1);
      expect(result.skipped).toHaveLength(1);
      expect(result.errors).toHaveLength(0);
      expect(result.imported[0].name).toBe('新规则');
      expect(result.skipped[0].name).toBe('重复规则');
    });

    test('应该能够更新现有规则', async () => {
      // 先创建一个规则
      const existingRule = await manager.createRule('现有规则', ExceptionRuleType.PAUSE_ONLY, '原始描述');

      const rulesToImport = [
        {
          name: '现有规则',
          type: ExceptionRuleType.EARLY_COMPLETION_ONLY,
          description: '更新后的描述'
        }
      ];

      const result = await manager.importRules(rulesToImport, { updateExisting: true });

      expect(result.imported).toHaveLength(1);
      expect(result.skipped).toHaveLength(0);
      expect(result.errors).toHaveLength(0);

      // 验证规则已更新
      const updatedRule = await manager.getRuleById(existingRule.rule.id);
      expect(updatedRule?.type).toBe(ExceptionRuleType.EARLY_COMPLETION_ONLY);
      expect(updatedRule?.description).toBe('更新后的描述');
    });

    test('应该处理导入错误', async () => {
      const rulesToImport = [
        {
          name: '有效规则',
          type: ExceptionRuleType.PAUSE_ONLY,
          description: '这是有效规则'
        },
        {
          name: '', // 无效的空名称
          type: ExceptionRuleType.PAUSE_ONLY,
          description: '无效规则'
        }
      ];

      const result = await manager.importRules(rulesToImport);

      expect(result.imported).toHaveLength(1);
      expect(result.errors).toHaveLength(1);
      expect(result.imported[0].name).toBe('有效规则');
    });

    test('应该处理批量导入', async () => {
      // 创建大量规则进行导入
      const rulesToImport = Array.from({ length: 50 }, (_, i) => ({
        name: `批量规则${i + 1}`,
        type: i % 2 === 0 ? ExceptionRuleType.PAUSE_ONLY : ExceptionRuleType.EARLY_COMPLETION_ONLY,
        description: `批量导入的规则 ${i + 1}`
      }));

      const result = await manager.importRules(rulesToImport);

      expect(result.imported).toHaveLength(50);
      expect(result.skipped).toHaveLength(0);
      expect(result.errors).toHaveLength(0);

      // 验证所有规则都已创建
      const allRules = await manager.getAllRules();
      const activeRules = allRules.filter(rule => rule.isActive);
      expect(activeRules).toHaveLength(50);
    });
  });

  describe('导出导入循环测试', () => {
    test('导出后再导入应该保持数据一致性', async () => {
      // 创建原始规则
      const originalRules = [
        await manager.createRule('规则1', ExceptionRuleType.PAUSE_ONLY, '描述1'),
        await manager.createRule('规则2', ExceptionRuleType.EARLY_COMPLETION_ONLY, '描述2'),
        await manager.createRule('规则3', ExceptionRuleType.PAUSE_ONLY, '描述3')
      ];

      // 模拟使用规则
      const sessionContext = {
        sessionId: 'session_1',
        chainId: 'chain_1',
        chainName: '测试任务',
        startedAt: new Date(),
        elapsedTime: 300,
        remainingTime: 600,
        isDurationless: false
      };

      await manager.useRule(originalRules[0].rule.id, sessionContext, 'pause');
      await manager.useRule(originalRules[1].rule.id, sessionContext, 'early_completion');

      // 导出数据
      const exportData = await manager.exportRules(true);

      // 清空当前数据
      for (const rule of originalRules) {
        await manager.deleteRule(rule.rule.id);
      }

      // 验证数据已清空
      const emptyRules = await manager.getAllRules();
      const activeEmptyRules = emptyRules.filter(rule => rule.isActive);
      expect(activeEmptyRules).toHaveLength(0);

      // 导入数据
      const importResult = await manager.importRules(
        exportData.rules.map(rule => ({
          name: rule.name,
          type: rule.type,
          description: rule.description
        }))
      );

      expect(importResult.imported).toHaveLength(3);
      expect(importResult.errors).toHaveLength(0);

      // 验证导入的规则与原始规则一致
      const importedRules = await manager.getAllRules();
      const activeImportedRules = importedRules.filter(rule => rule.isActive);
      
      expect(activeImportedRules).toHaveLength(3);
      
      // 验证规则名称和类型
      const ruleNames = activeImportedRules.map(rule => rule.name).sort();
      const expectedNames = ['规则1', '规则2', '规则3'];
      expect(ruleNames).toEqual(expectedNames);

      // 验证规则类型
      const pauseRules = activeImportedRules.filter(rule => rule.type === ExceptionRuleType.PAUSE_ONLY);
      const completionRules = activeImportedRules.filter(rule => rule.type === ExceptionRuleType.EARLY_COMPLETION_ONLY);
      
      expect(pauseRules).toHaveLength(2);
      expect(completionRules).toHaveLength(1);
    });

    test('应该处理部分导入失败的情况', async () => {
      // 创建一些规则
      await manager.createRule('现有规则', ExceptionRuleType.PAUSE_ONLY);

      // 准备导入数据，包含重复和无效规则
      const rulesToImport = [
        {
          name: '现有规则', // 重复
          type: ExceptionRuleType.PAUSE_ONLY,
          description: '重复规则'
        },
        {
          name: '新规则1',
          type: ExceptionRuleType.PAUSE_ONLY,
          description: '有效的新规则'
        },
        {
          name: '', // 无效
          type: ExceptionRuleType.PAUSE_ONLY,
          description: '无效规则'
        },
        {
          name: '新规则2',
          type: ExceptionRuleType.EARLY_COMPLETION_ONLY,
          description: '另一个有效规则'
        }
      ];

      const result = await manager.importRules(rulesToImport, { skipDuplicates: true });

      expect(result.imported).toHaveLength(2); // 新规则1和新规则2
      expect(result.skipped).toHaveLength(1);  // 现有规则
      expect(result.errors).toHaveLength(1);   // 空名称规则

      // 验证最终状态
      const allRules = await manager.getAllRules();
      const activeRules = allRules.filter(rule => rule.isActive);
      expect(activeRules).toHaveLength(3); // 现有规则 + 新规则1 + 新规则2
    });
  });
});