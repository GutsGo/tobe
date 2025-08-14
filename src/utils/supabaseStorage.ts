import { supabase, getCurrentUser } from '../lib/supabase';
import { Chain, DeletedChain, ScheduledSession, ActiveSession, CompletionHistory, RSIPNode, RSIPMeta } from '../types';
import { logger, measurePerformance } from './logger';

interface SchemaVerificationResult {
  hasAllColumns: boolean;
  missingColumns: string[];
  error?: string;
}

export class SupabaseStorage {
  private schemaCache: Map<string, SchemaVerificationResult> = new Map();
  private lastSchemaCheck: Date | null = null;
  
  /**
   * Retry a database operation with exponential backoff
   */
  private async retryOperation<T>(
    operation: () => Promise<T>,
    maxRetries: number = 3,
    baseDelay: number = 1000
  ): Promise<T> {
    let lastError: Error;
    
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        return await operation();
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
        
        // Don't retry for certain types of errors
        if (error && typeof error === 'object' && 'code' in error) {
          const errorCode = (error as any).code;
          if (['PGRST204', 'PGRST116', '42703', '42P01'].includes(errorCode)) {
            throw lastError;
          }
        }
        
        if (attempt === maxRetries) {
          console.error(`操作在 ${maxRetries} 次重试后仍失败:`, lastError.message);
          throw lastError;
        }
        
        const delay = baseDelay * Math.pow(2, attempt);
        console.warn(`操作失败，${delay}ms 后重试 (尝试 ${attempt + 1}/${maxRetries}):`, lastError.message);
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
    
    throw lastError!;
  }
  
  /**
   * Clear schema cache to force re-verification
   */
  clearSchemaCache(): void {
    this.schemaCache.clear();
    this.lastSchemaCheck = null;
    console.log('Schema cache cleared - will re-verify database schema');
  }

  /**
   * Verify that required columns exist in the database schema
   */
  async verifySchemaColumns(tableName: string, requiredColumns: string[]): Promise<SchemaVerificationResult> {
    const cacheKey = `${tableName}:${requiredColumns.join(',')}`;
    const now = new Date();
    
    // Use cached result if it's less than 1 minute old (reduced from 5 minutes)
    if (this.lastSchemaCheck && (now.getTime() - this.lastSchemaCheck.getTime()) < 60000) {
      const cached = this.schemaCache.get(cacheKey);
      if (cached) {
        console.log('Using cached schema verification result');
        return cached;
      }
    }
    
    try {
      // Query information_schema to check column existence
      const { data, error } = await supabase
        .from('information_schema.columns')
        .select('column_name')
        .eq('table_name', tableName)
        .in('column_name', requiredColumns);
        
      if (error) {
        console.warn('Schema verification failed:', error);
        return { hasAllColumns: false, missingColumns: requiredColumns, error: error.message };
      }
      
      const existingColumns = (data || []).map(row => row.column_name);
      const missingColumns = requiredColumns.filter(col => !existingColumns.includes(col));
      
      const result: SchemaVerificationResult = {
        hasAllColumns: missingColumns.length === 0,
        missingColumns,
      };
      
      // Cache the result
      this.schemaCache.set(cacheKey, result);
      this.lastSchemaCheck = now;
      
      return result;
    } catch (error) {
      console.warn('Schema verification error:', error);
      return { 
        hasAllColumns: false, 
        missingColumns: requiredColumns, 
        error: error instanceof Error ? error.message : 'Unknown error' 
      };
    }
  }

  // Chains
  async getChains(): Promise<Chain[]> {
    const user = await getCurrentUser();
    if (!user) {
      console.warn('getChains: 用户未认证');
      return [];
    }

    console.log('[DEBUG] getChains - 当前用户ID:', user.id);

    try {
      const { data, error } = await supabase
        .from('chains')
        .select('*')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false });

      if (error) {
        console.error('获取链数据失败:', {
          code: error.code,
          message: error.message,
          details: error.details,
          hint: error.hint,
          userId: user.id,
          timestamp: new Date().toISOString()
        });
        
        // Return empty array for non-critical errors
        if (error.code === 'PGRST116' || error.message?.includes('relation') || error.message?.includes('does not exist')) {
          console.warn('表不存在或权限问题，返回空数组');
          return [];
        }
        
        throw new Error(`获取链数据失败: ${error.message}`);
      }

      const chainCount = data?.length || 0;
      logger.dbOperation('getChains', true, { chainCount, userId: user.id });
      
      const mappedChains = data.map(chain => ({
      id: chain.id,
      name: chain.name,
      parentId: chain.parent_id || undefined,
      type: chain.type as Chain['type'],
      sortOrder: chain.sort_order,
      trigger: chain.trigger,
      duration: chain.duration,
      description: chain.description,
      currentStreak: chain.current_streak,
      auxiliaryStreak: chain.auxiliary_streak,
      totalCompletions: chain.total_completions,
      totalFailures: chain.total_failures,
      auxiliaryFailures: chain.auxiliary_failures,
      exceptions: Array.isArray(chain.exceptions) ? chain.exceptions as string[] : [],
      auxiliaryExceptions: Array.isArray(chain.auxiliary_exceptions) ? chain.auxiliary_exceptions as string[] : [],
      auxiliarySignal: chain.auxiliary_signal,
      auxiliaryDuration: chain.auxiliary_duration,
      auxiliaryCompletionTrigger: chain.auxiliary_completion_trigger,
      // 兼容：如果后端没有此字段，将为 undefined
      isDurationless: (chain as any).is_durationless ?? false,
      timeLimitHours: (chain as any).time_limit_hours ?? undefined,
      timeLimitExceptions: Array.isArray((chain as any).time_limit_exceptions) ? (chain as any).time_limit_exceptions : [],
      groupStartedAt: (chain as any).group_started_at ? new Date((chain as any).group_started_at) : undefined,
      groupExpiresAt: (chain as any).group_expires_at ? new Date((chain as any).group_expires_at) : undefined,
      deletedAt: (chain as any).deleted_at ? new Date((chain as any).deleted_at) : null,
      createdAt: new Date(chain.created_at || Date.now()),
      lastCompletedAt: chain.last_completed_at ? new Date(chain.last_completed_at) : undefined,
    }));
    
    // 添加调试日志来检查 deleted_at 字段的映射
    console.log('[DEBUG] getChains - 原始数据样本:', data.slice(0, 7).map(c => ({ 
      id: c.id, 
      name: c.name, 
      deleted_at: (c as any).deleted_at,
      deleted_at_type: typeof (c as any).deleted_at
    })));
    
    console.log('[DEBUG] getChains - 映射后数据样本:', mappedChains.slice(0, 7).map(c => ({ 
      id: c.id, 
      name: c.name, 
      deletedAt: c.deletedAt,
      deletedAtType: typeof c.deletedAt,
      isDeleted: c.deletedAt != null
    })));
    
    return mappedChains;
    } catch (error) {
      console.error('getChains 操作异常:', {
        error: error instanceof Error ? error.message : error,
        userId: user.id,
        timestamp: new Date().toISOString()
      });
      
      // For network or other critical errors, throw to let caller handle
      if (error instanceof Error && (error.message.includes('fetch') || error.message.includes('network'))) {
        throw error;
      }
      
      return [];
    }
  }

  // 回收箱相关方法
  async getActiveChains(): Promise<Chain[]> {
    const allChains = await this.getChains();
    console.log('[DEBUG] getActiveChains - 所有链条:', allChains.length, allChains.map(c => ({ 
      id: c.id, 
      name: c.name, 
      deletedAt: c.deletedAt,
      deletedAtType: typeof c.deletedAt,
      isDeleted: c.deletedAt != null
    })));
    
    // 过滤掉已删除的链条（deletedAt不为null且不为undefined）
    const activeChains = allChains.filter(chain => chain.deletedAt == null);
    console.log('[DEBUG] getActiveChains - 活跃链条:', activeChains.length, activeChains.map(c => ({ 
      id: c.id, 
      name: c.name, 
      deletedAt: c.deletedAt 
    })));
    
    return activeChains;
  }

  async getDeletedChains(): Promise<DeletedChain[]> {
    try {
      const allChains = await this.getChains();
      console.log('[DEBUG] getDeletedChains - 所有链条:', allChains.length, allChains.map(c => ({ 
        id: c.id, 
        name: c.name, 
        deletedAt: c.deletedAt,
        deletedAtType: typeof c.deletedAt
      })));
      
      const deletedChains = allChains.filter(chain => chain.deletedAt != null);
      console.log('[DEBUG] getDeletedChains - 已删除链条:', deletedChains.length, deletedChains.map(c => ({ 
        id: c.id, 
        name: c.name, 
        deletedAt: c.deletedAt 
      })));
      
      return deletedChains
        .map(chain => ({ ...chain, deletedAt: chain.deletedAt! }))
        .sort((a, b) => b.deletedAt.getTime() - a.deletedAt.getTime());
    } catch (error) {
      // 如果获取链条失败，返回空数组
      console.warn('获取已删除链条失败，可能是数据库不支持软删除:', error);
      return [];
    }
  }

  async softDeleteChain(chainId: string): Promise<void> {
    const user = await getCurrentUser();
    if (!user) {
      throw new Error('用户未认证，无法删除链条');
    }

    // 获取所有链条以找到子链条
    const allChains = await this.getChains();
    const chainsToDelete = this.findChainAndChildren(chainId, allChains);
    
    try {
      // 尝试批量软删除
      const { error } = await supabase
        .from('chains')
        .update({ deleted_at: new Date().toISOString() })
        .in('id', chainsToDelete.map(c => c.id))
        .eq('user_id', user.id);

      if (error) {
        // 如果数据库不支持 deleted_at 字段，回退到永久删除
        if (error.code === '42703' || error.message?.includes('deleted_at') || error.code === 'PGRST204') {
          console.warn('数据库不支持软删除，执行永久删除');
          await this.permanentlyDeleteChain(chainId);
          return;
        }
        console.error('软删除链条失败:', error);
        throw new Error(`软删除链条失败: ${error.message}`);
      }
    } catch (error) {
      // 如果是字段不存在的错误，回退到永久删除
      if (error instanceof Error && (error.message.includes('deleted_at') || error.message.includes('PGRST204'))) {
        console.warn('数据库不支持软删除，执行永久删除');
        await this.permanentlyDeleteChain(chainId);
        return;
      }
      throw error;
    }
  }

  async restoreChain(chainId: string): Promise<void> {
    const user = await getCurrentUser();
    if (!user) {
      throw new Error('用户未认证，无法恢复链条');
    }

    try {
      // 获取所有链条以找到子链条
      const allChains = await this.getChains();
      const chainsToRestore = this.findChainAndChildren(chainId, allChains);
      
      // 批量恢复
      const { error } = await supabase
        .from('chains')
        .update({ deleted_at: null })
        .in('id', chainsToRestore.map(c => c.id))
        .eq('user_id', user.id);

      if (error) {
        // 如果数据库不支持 deleted_at 字段，说明链条已经被永久删除，无法恢复
        if (error.code === '42703' || error.message?.includes('deleted_at') || error.code === 'PGRST204') {
          throw new Error('数据库不支持软删除功能，无法恢复已删除的链条');
        }
        console.error('恢复链条失败:', error);
        throw new Error(`恢复链条失败: ${error.message}`);
      }
    } catch (error) {
      if (error instanceof Error && (error.message.includes('deleted_at') || error.message.includes('PGRST204'))) {
        throw new Error('数据库不支持软删除功能，无法恢复已删除的链条');
      }
      throw error;
    }
  }

  async permanentlyDeleteChain(chainId: string): Promise<void> {
    const user = await getCurrentUser();
    if (!user) {
      throw new Error('用户未认证，无法删除链条');
    }

    // 获取所有链条以找到子链条
    const allChains = await this.getChains();
    const chainsToDelete = this.findChainAndChildren(chainId, allChains);
    
    // 批量永久删除
    const { error } = await supabase
      .from('chains')
      .delete()
      .in('id', chainsToDelete.map(c => c.id))
      .eq('user_id', user.id);

    if (error) {
      console.error('永久删除链条失败:', error);
      throw new Error(`永久删除链条失败: ${error.message}`);
    }
  }

  async cleanupExpiredDeletedChains(olderThanDays: number = 30): Promise<number> {
    const user = await getCurrentUser();
    if (!user) {
      return 0;
    }

    try {
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - olderThanDays);

      // 查找过期的已删除链条
      const { data: expiredChains, error: selectError } = await supabase
        .from('chains')
        .select('id')
        .eq('user_id', user.id)
        .not('deleted_at', 'is', null)
        .lt('deleted_at', cutoffDate.toISOString());

      if (selectError) {
        // 如果数据库没有 deleted_at 字段，直接返回0，不抛出错误
        if (selectError.code === '42703' || selectError.message?.includes('deleted_at does not exist')) {
          console.warn('数据库没有 deleted_at 字段，跳过自动清理');
          return 0;
        }
        console.error('查找过期链条失败:', selectError);
        throw new Error(`查找过期链条失败: ${selectError.message}`);
      }

      if (!expiredChains || expiredChains.length === 0) {
        return 0;
      }

      // 永久删除过期链条
      const { error: deleteError } = await supabase
        .from('chains')
        .delete()
        .in('id', expiredChains.map(c => c.id))
        .eq('user_id', user.id);

      if (deleteError) {
        console.error('清理过期链条失败:', deleteError);
        throw new Error(`清理过期链条失败: ${deleteError.message}`);
      }

      return expiredChains.length;
    } catch (error) {
      // 如果是字段不存在的错误，不抛出异常，只是记录警告
      if (error instanceof Error && error.message.includes('deleted_at does not exist')) {
        console.warn('数据库架构不支持软删除，跳过自动清理');
        return 0;
      }
      throw error;
    }
  }

  // 辅助方法：查找链条及其所有子链条
  private findChainAndChildren(chainId: string, allChains: Chain[]): Chain[] {
    const result: Chain[] = [];
    const visited = new Set<string>();

    const findRecursive = (id: string) => {
      if (visited.has(id)) return;
      visited.add(id);

      const chain = allChains.find(c => c.id === id);
      if (chain) {
        result.push(chain);
        // 查找所有子链条
        const children = allChains.filter(c => c.parentId === id);
        children.forEach(child => findRecursive(child.id));
      }
    };

    findRecursive(chainId);
    return result;
  }

  async saveChains(chains: Chain[]): Promise<void> {
    const user = await getCurrentUser();
    if (!user) {
      const error = new Error('用户未认证，无法保存数据');
      console.error('No authenticated user found when trying to save chains');
      throw error;
    }

    console.log('正在为用户保存链数据:', user.id, '链数量:', chains.length);
    console.log('要保存的链条详情:', chains.map(c => ({ 
      id: c.id, 
      name: c.name, 
      type: c.type,
      parentId: c.parentId,
      sortOrder: c.sortOrder 
    })));

    // Verify schema before attempting to save
    const newColumns = ['is_durationless', 'time_limit_hours', 'time_limit_exceptions', 'group_started_at', 'group_expires_at', 'deleted_at'];
    const schemaCheck = await this.verifySchemaColumns('chains', newColumns);
    
    if (!schemaCheck.hasAllColumns) {
      console.warn('数据库架构检查发现缺失列:', schemaCheck.missingColumns);
    }

    // 生成两套数据：完整字段集（包含新列）与基础字段集（兼容旧后端）
    const buildRow = (chain: Chain, includeNewColumns: boolean) => {
      let parentId = chain.parentId || null;
      if (parentId === chain.id) {
        console.warn(`检测到循环引用: 链条 ${chain.name} (${chain.id}) 的父节点是自己，重置为null`);
        parentId = null;
      }

      const base: any = {
        id: chain.id,
        name: chain.name,
        parent_id: parentId,
        type: chain.type || 'unit',
        sort_order: chain.sortOrder || Math.floor(Date.now() / 1000),
        trigger: chain.trigger,
        duration: chain.duration,
        description: chain.description,
        current_streak: chain.currentStreak,
        auxiliary_streak: chain.auxiliaryStreak,
        total_completions: chain.totalCompletions,
        total_failures: chain.totalFailures,
        auxiliary_failures: chain.auxiliaryFailures,
        exceptions: chain.exceptions,
        auxiliary_exceptions: chain.auxiliaryExceptions,
        auxiliary_signal: chain.auxiliarySignal,
        auxiliary_duration: chain.auxiliaryDuration,
        auxiliary_completion_trigger: chain.auxiliaryCompletionTrigger,
        created_at: chain.createdAt.toISOString(),
        last_completed_at: chain.lastCompletedAt?.toISOString(),
        user_id: user.id,
      };

      if (!includeNewColumns) return base;

      return {
        ...base,
        // 新增列：后端不支持时将触发回退逻辑
        is_durationless: chain.isDurationless ?? false,
        time_limit_hours: chain.timeLimitHours ?? null,
        time_limit_exceptions: chain.timeLimitExceptions ?? [],
        group_started_at: chain.groupStartedAt ? chain.groupStartedAt.toISOString() : null,
        group_expires_at: chain.groupExpiresAt ? chain.groupExpiresAt.toISOString() : null,
        deleted_at: chain.deletedAt?.toISOString() || null,
      } as any;
    };

    const rowsWithNew = chains.map(c => buildRow(c, true));
    const rowsBase = chains.map(c => buildRow(c, false));

    const isMissingColumnError = (e: any) => {
      if (!e) return false;
      const msg = `${e.message || ''} ${e.details || ''}`.toLowerCase();
      const code = e.code || '';
      
      // Enhanced error detection patterns
      const patterns = [
        /column .* does not exist/,
        /schema cache/,
        /could not find .* column/,
        /relation .* does not exist/,
        /unknown column/,
        /invalid column name/,
        /column .* not found/,
        /undefined column/
      ];
      
      // Check for specific error codes
      const errorCodes = ['PGRST204', 'PGRST116', '42703', '42P01'];
      
      return patterns.some(pattern => pattern.test(msg)) || errorCodes.includes(code);
    };

    // 查询现有ID，用于决定删除哪些已被移除的链
    const { data: existingRows, error: existingErr } = await supabase
      .from('chains')
      .select('id')
      .eq('user_id', user.id);
    if (existingErr) {
      console.error('查询现有链ID失败:', existingErr);
      throw new Error(`查询现有数据失败: ${existingErr.message}`);
    }
    const existingIds = new Set((existingRows || []).map(r => r.id as string));

    // 先尝试使用包含新列的 upsert；若后端缺列，则回退到基础列
    let upsertResultIds: string[] = [];
    const tryUpsert = async (rows: any[]) => {
      const { data, error } = await supabase
        .from('chains')
        .upsert(rows, { onConflict: 'id' })
        .select('id');
      return { data, error } as { data: { id: string }[] | null, error: any };
    };

    let { data: upsertData1, error: upsertErr1 } = await tryUpsert(rowsWithNew);
    if (upsertErr1 && isMissingColumnError(upsertErr1)) {
      console.warn('检测到后端缺少新列，回退到基础字段保存。错误信息:', {
        code: upsertErr1.code,
        message: upsertErr1.message,
        details: upsertErr1.details,
        timestamp: new Date().toISOString()
      });
      
      // Implement retry with exponential backoff for fallback
      let retryCount = 0;
      const maxRetries = 3;
      let fallbackSuccess = false;
      
      while (retryCount < maxRetries && !fallbackSuccess) {
        try {
          const { data: upsertData2, error: upsertErr2 } = await tryUpsert(rowsBase);
          if (upsertErr2) {
            retryCount++;
            if (retryCount >= maxRetries) {
              console.error('回退保存在重试后仍失败:', upsertErr2);
              throw new Error(`保存数据失败 (重试 ${maxRetries} 次后): ${upsertErr2.message}`);
            }
            // Wait before retry (exponential backoff)
            await new Promise(resolve => setTimeout(resolve, Math.pow(2, retryCount) * 1000));
          } else {
            upsertResultIds = (upsertData2 || []).map(r => r.id);
            fallbackSuccess = true;
            console.log('回退保存成功，使用基础字段集');
          }
        } catch (retryError) {
          retryCount++;
          if (retryCount >= maxRetries) {
            throw retryError;
          }
        }
      }
    } else if (upsertErr1) {
      console.error('保存失败:', {
        code: upsertErr1.code,
        message: upsertErr1.message,
        details: upsertErr1.details,
        timestamp: new Date().toISOString()
      });
      throw new Error(`保存数据失败: ${upsertErr1.message}`);
    } else {
      upsertResultIds = (upsertData1 || []).map(r => r.id);
      console.log('保存成功，使用完整字段集');
    }

    // 仅删除那些不在本次保存集合中的旧链，避免“先删后插”带来的数据丢失
    const newIds = new Set(chains.map(c => c.id));
    const idsToDelete = [...existingIds].filter(id => !newIds.has(id));
    if (idsToDelete.length > 0) {
      const { error: delErr } = await supabase
        .from('chains')
        .delete()
        .in('id', idsToDelete)
        .eq('user_id', user.id);
      if (delErr) {
        console.error('删除多余链失败:', delErr);
        throw new Error(`删除多余数据失败: ${delErr.message}`);
      }
    }

    // 最终确认
    const savedIds = new Set(upsertResultIds);
    const expectedIds = new Set(chains.map(c => c.id));
    const missingSavedIds = [...expectedIds].filter(id => !savedIds.has(id));
    if (missingSavedIds.length > 0) {
      console.warn('部分链条在返回结果中缺失（可能因旧后端未返回所有行）。缺失IDs:', missingSavedIds);
    }

    console.log('所有链数据保存流程完成');
  }

  // Scheduled Sessions
  async getScheduledSessions(): Promise<ScheduledSession[]> {
    const user = await getCurrentUser();
    if (!user) return [];

    const { data, error } = await supabase
      .from('scheduled_sessions')
      .select('*')
      .eq('user_id', user.id)
      .order('scheduled_at', { ascending: false });

    if (error) {
      console.error('Error fetching scheduled sessions:', error);
      return [];
    }

    return data.map(session => ({
      chainId: session.chain_id,
      scheduledAt: new Date(session.scheduled_at),
      expiresAt: new Date(session.expires_at),
      auxiliarySignal: session.auxiliary_signal,
    }));
  }

  async saveScheduledSessions(sessions: ScheduledSession[]): Promise<void> {
    const user = await getCurrentUser();
    if (!user) return;

    // Delete all existing sessions for this user
    await supabase
      .from('scheduled_sessions')
      .delete()
      .eq('user_id', user.id);

    // Insert new sessions
    if (sessions.length > 0) {
      const { error } = await supabase
        .from('scheduled_sessions')
        .insert(sessions.map(session => ({
          chain_id: session.chainId,
          scheduled_at: session.scheduledAt.toISOString(),
          expires_at: session.expiresAt.toISOString(),
          auxiliary_signal: session.auxiliarySignal,
          user_id: user.id,
        })));

      if (error) {
        console.error('Error saving scheduled sessions:', error);
      }
    }
  }

  // Active Session
  async getActiveSession(): Promise<ActiveSession | null> {
    const user = await getCurrentUser();
    if (!user) return null;

    const { data, error } = await supabase
      .from('active_sessions')
      .select('*')
      .eq('user_id', user.id)
      .limit(1);

    if (error || !data || data.length === 0) {
      return null;
    }

    const sessionData = data[0];

    return {
      chainId: sessionData.chain_id,
      startedAt: new Date(sessionData.started_at),
      duration: sessionData.duration,
      isPaused: sessionData.is_paused,
      pausedAt: sessionData.paused_at ? new Date(sessionData.paused_at) : undefined,
      totalPausedTime: sessionData.total_paused_time,
    };
  }

  async saveActiveSession(session: ActiveSession | null): Promise<void> {
    const user = await getCurrentUser();
    if (!user) return;

    // Delete existing active session
    await supabase
      .from('active_sessions')
      .delete()
      .eq('user_id', user.id);

    // Insert new session if provided
    if (session) {
      const { error } = await supabase
        .from('active_sessions')
        .insert({
          chain_id: session.chainId,
          started_at: session.startedAt.toISOString(),
          duration: session.duration,
          is_paused: session.isPaused,
          paused_at: session.pausedAt?.toISOString(),
          total_paused_time: session.totalPausedTime,
          user_id: user.id,
        });

      if (error) {
        console.error('Error saving active session:', error);
      }
    }
  }

  // Completion History
  async getCompletionHistory(): Promise<CompletionHistory[]> {
    const user = await getCurrentUser();
    if (!user) return [];

    const { data, error } = await supabase
      .from('completion_history')
      .select('*')
      .eq('user_id', user.id)
      .order('completed_at', { ascending: false });

    if (error) {
      console.error('Error fetching completion history:', error);
      return [];
    }

    return data.map(history => ({
      chainId: history.chain_id,
      completedAt: new Date(history.completed_at),
      duration: history.duration,
      wasSuccessful: history.was_successful,
      reasonForFailure: history.reason_for_failure || undefined,
    }));
  }

  async saveCompletionHistory(history: CompletionHistory[]): Promise<void> {
    const user = await getCurrentUser();
    if (!user) return;

    // Get existing history to determine what's new
    const { data: existingHistory } = await supabase
      .from('completion_history')
      .select('chain_id, completed_at')
      .eq('user_id', user.id);

    const existingKeys = new Set(
      existingHistory?.map(h => `${h.chain_id}-${h.completed_at}`) || []
    );

    const newHistory = history.filter(h => 
      !existingKeys.has(`${h.chainId}-${h.completedAt.toISOString()}`)
    );

    // Insert new history records
    if (newHistory.length > 0) {
      const { error } = await supabase
        .from('completion_history')
        .insert(newHistory.map(h => ({
          chain_id: h.chainId,
          completed_at: h.completedAt.toISOString(),
          duration: h.duration,
          was_successful: h.wasSuccessful,
          reason_for_failure: h.reasonForFailure,
          user_id: user.id,
        })));

      if (error) {
        console.error('Error saving completion history:', error);
      }
    }
  }

  // RSIP nodes
  async getRSIPNodes(): Promise<RSIPNode[]> {
    const user = await getCurrentUser();
    if (!user) return [];

    const { data, error } = await supabase
      .from('rsip_nodes')
      .select('*')
      .eq('user_id', user.id)
      .order('sort_order', { ascending: true });

    if (error) {
      console.error('Error fetching RSIP nodes:', error);
      return [];
    }

    return (data || []).map(row => ({
      id: row.id,
      parentId: row.parent_id || undefined,
      title: row.title,
      rule: row.rule,
      sortOrder: row.sort_order,
      createdAt: new Date(row.created_at),
      useTimer: (row as any).use_timer ?? false,
      timerMinutes: (row as any).timer_minutes ?? undefined,
    }));
  }

  async saveRSIPNodes(nodes: RSIPNode[]): Promise<void> {
    const user = await getCurrentUser();
    if (!user) return;

    // Upsert all nodes for user
    const rows = nodes.map(n => ({
      id: n.id,
      parent_id: n.parentId || null,
      title: n.title,
      rule: n.rule,
      sort_order: n.sortOrder,
      created_at: n.createdAt.toISOString(),
      use_timer: n.useTimer ?? false,
      timer_minutes: n.timerMinutes ?? null,
      user_id: user.id,
    }));

    // Fetch existing ids to delete removed ones
    const { data: existingRows, error: existingErr } = await supabase
      .from('rsip_nodes')
      .select('id')
      .eq('user_id', user.id);
    if (existingErr) {
      console.error('查询现有RSIP节点失败:', existingErr);
      throw new Error(`查询现有RSIP节点失败: ${existingErr.message}`);
    }
    const existingIds = new Set((existingRows || []).map(r => r.id as string));
    const newIds = new Set(nodes.map(n => n.id));
    const idsToDelete = [...existingIds].filter(id => !newIds.has(id));

    if (idsToDelete.length > 0) {
      const { error: delErr } = await supabase
        .from('rsip_nodes')
        .delete()
        .in('id', idsToDelete)
        .eq('user_id', user.id);
      if (delErr) {
        console.error('删除多余RSIP节点失败:', delErr);
        throw new Error(`删除多余RSIP节点失败: ${delErr.message}`);
      }
    }

    const { error } = await supabase
      .from('rsip_nodes')
      .upsert(rows, { onConflict: 'id' });
    if (error) {
      console.error('Error saving RSIP nodes:', error);
      throw new Error(`保存RSIP节点失败: ${error.message}`);
    }
  }

  async getRSIPMeta(): Promise<RSIPMeta> {
    const user = await getCurrentUser();
    if (!user) return {};
    const { data, error } = await supabase
      .from('rsip_meta')
      .select('*')
      .eq('user_id', user.id)
      .limit(1);
    if (error || !data || data.length === 0) return {};
    const row = data[0];
    return {
      lastAddedAt: row.last_added_at ? new Date(row.last_added_at) : undefined,
      allowMultiplePerDay: !!row.allow_multiple_per_day,
    };
  }

  async saveRSIPMeta(meta: RSIPMeta): Promise<void> {
    const user = await getCurrentUser();
    if (!user) return;
    const { error } = await supabase
      .from('rsip_meta')
      .upsert({
        user_id: user.id,
        last_added_at: meta.lastAddedAt ? meta.lastAddedAt.toISOString() : null,
        allow_multiple_per_day: !!meta.allowMultiplePerDay,
      }, { onConflict: 'user_id' });
    if (error) {
      console.error('保存RSIP元数据失败:', error);
      throw new Error(`保存RSIP元数据失败: ${error.message}`);
    }
  }
}

export const supabaseStorage = new SupabaseStorage();

// Clear schema cache on module load to ensure fresh schema verification
supabaseStorage.clearSchemaCache();