/* 基准映射业务规则校验脚本（仅本地验证用，不参与前端打包）。 */

// 浏览器 localStorage 的内存垫片，必须在导入数据层之前挂到 globalThis。
class MemoryStorage {
  private store = new Map<string, string>()
  getItem(key: string) { return this.store.has(key) ? this.store.get(key)! : null }
  setItem(key: string, value: string) { this.store.set(key, String(value)) }
  removeItem(key: string) { this.store.delete(key) }
  clear() { this.store.clear() }
}
const storage = new MemoryStorage()
;(globalThis as unknown as { window: { localStorage: MemoryStorage } }).window = { localStorage: storage }

let pass = 0
let fail = 0
function check(name: string, condition: boolean, detail = '') {
  if (condition) {
    pass += 1
    console.log(`  ✓ ${name}`)
  } else {
    fail += 1
    console.error(`  ✗ ${name} ${detail}`)
  }
}

const service = await import('@/api/mapping-service')
const { listMappings, saveMappings, resetMappings } = await import('@/data/mapping-store')
const { listRows } = await import('@/data/local-store')

console.log('1) 验收样例：BENC-0002 次月留存 42% / monthly / R-2026-11 → RETE-0002')
const seed = listMappings()
check('种子存在 1 条 BMAP-0001', seed.length === 1 && seed[0].mappingNo === 'BMAP-0001')
const bmap = seed[0]
check('引用 BENC-0002 与 RETE-0002', bmap.benchmarkNo === 'BENC-0002' && bmap.retentionNo === 'RETE-0002')
check('对比指标=次月留存率、初始事件=付费下单', bmap.metric === '次月留存率' && bmap.initialEvent === '付费下单')
check('基准值 42%，来源 R-2026-11，周期 monthly', bmap.baselineValue === 42 && bmap.sourceRef === 'R-2026-11' && bmap.collectCycle === 'monthly')
check('候选阈值 38% 与留存差距 4 个百分点同时出现', bmap.candidateThreshold === 38 && bmap.estimatedGap === 4 && bmap.candidateThresholdText === '38%')
check('主对标未确认，状态为待确认', bmap.primaryConfirmed === false && bmap.status === '待确认')
check('对标结论同时引用基准值与留存结果', bmap.conclusion.includes('42%') && bmap.conclusion.includes('38%') && bmap.conclusion.includes('4 个百分点'))

console.log('2) 主对标未确认时不能启用')
const rejected = service.enableMapping(bmap.id)
check('启用被拒绝', rejected.ok === false && rejected.message.includes('主对标'))
const reteRows = listRows('retention')
const rete2 = reteRows.find((r) => String(r['方案编号']) === 'RETE-0002')!
check('留存方案未被启用', String(rete2.status) !== '已启用' && String(rete2['留存阈值']) !== '38%')

console.log('3) 确认主对标后启用，固定对标版本并回写留存阈值')
const confirmRes = service.confirmPrimary(bmap.id)
check('主对标确认成功', confirmRes.ok)
const enabled = service.enableMapping(bmap.id)
check('映射启用成功', enabled.ok, enabled.message)
const after = listMappings()[0]
check('状态=已启用且锁定版本非空', after.status === '已启用' && after.lockedBenchmarkVersion.includes('BENC-0002') && after.lockedBaselineValue === 42)
const rete2b = listRows('retention').find((r) => String(r['方案编号']) === 'RETE-0002')!
check('留存方案同步启用且阈值锁定 38%', String(rete2b.status) === '已启用' && String(rete2b['留存阈值']) === '38%')

console.log('4) 竞品基准变化超容限 → 只触发待复核，不改已启用方案')
const driftRes = service.applyBenchmarkDrift('BENC-0002', '47%')
check('基准推送成功', driftRes.ok)
const reviewing = listMappings()[0]
check('映射转为待复核', reviewing.status === '待复核')
check('漂移 +5 个百分点并记录复核原因', reviewing.drift === 5 && reviewing.reviewReason.includes('待人工复核'))
check('锁定版本与锁定基准仍是 42%', reviewing.lockedBaselineValue === 42 && reviewing.lockedBenchmarkVersion.includes('42pct'))
const rete2c = listRows('retention').find((r) => String(r['方案编号']) === 'RETE-0002')!
check('留存阈值保持 38% 未被改写', String(rete2c['留存阈值']) === '38%')
const benc2 = listRows('benchmark').find((r) => String(r['方案编号']) === 'BENC-0002')!
check('对标方案自身基准已更新为 47%', String(benc2['基准值']) === '47%')

console.log('5) 复核维持原版本 → 恢复已启用，阈值不变')
const keepRes = service.resolveReview(reviewing.id, false)
check('维持原版本复核成功', keepRes.ok && listMappings()[0].status === '已启用')
check('复核后锁定基准仍为 42%、阈值 38%', listMappings()[0].lockedBaselineValue === 42 && listMappings()[0].candidateThreshold === 38)

console.log('6) 容限内漂移不触发待复核')
service.applyBenchmarkDrift('BENC-0002', '45%') // 相对锁定 42% 漂移 3，容限 4
check('漂移 3 个百分点保持已启用', listMappings()[0].status === '已启用')
service.applyBenchmarkDrift('BENC-0002', '42%') // 还原

console.log('7) 映射失败：初始事件不属于留存方案 → 两边都不进入启用状态')
const failRes = service.generateMapping({ benchmarkNo: 'BENC-0003', retentionNo: 'RETE-0002', metric: '次月留存率', initialEvent: '不存在的事件' })
check('生成返回失败', failRes.ok === false && failRes.message.includes('映射失败'))
const failed = listMappings().find((m) => m.status === '映射失败')!
check('失败记录落库且写明异常原因', !!failed && failed.failReason.includes('初始事件'))
const enableFailed = service.enableMapping(failed.id)
check('失败映射不能启用', enableFailed.ok === false)
const benc3 = listRows('benchmark').find((r) => String(r['方案编号']) === 'BENC-0003')!
check('原已启用的 BENC-0003 被挡回非启用状态', String(benc3.status) !== '已启用')

console.log('8) 同一人群两个对标方案：主对标仲裁，副对标不能重复启用')
const second = service.generateMapping({ benchmarkNo: 'BENC-0003', retentionNo: 'RETE-0002', metric: '次月留存率', initialEvent: '付费下单' })
check('第二份映射生成成功（同人群）', second.ok, second.message)
const secondId = second.record!.id
const enableUnconfirmed = service.enableMapping(secondId)
check('未确认主对标的第二份映射不能启用', enableUnconfirmed.ok === false)
service.confirmPrimary(secondId)
const conflict = service.enableMapping(secondId)
check('已有同人群主对标启用时，重复启用被拒绝', conflict.ok === false && conflict.message.includes('主对标'))

console.log('9) 空数据与中断恢复')
saveMappings([])
check('映射清空后列表为空（页面展示空态）', listMappings().length === 0)
resetMappings()
const task = service.saveRecoveryTask({ benchmarkNo: 'BENC-0002', retentionNo: 'RETE-0002', stage: '候选阈值计算', reason: '模拟中断原因' })
check('中断任务已记录并带异常原因', service.listRecoveryTasks().length === 1 && task.reason === '模拟中断原因')
const retry = service.generateMapping({ benchmarkNo: 'BENC-0002', retentionNo: 'RETE-0003', metric: '次月留存率', initialEvent: '内容浏览' })
check('重试生成新映射成功', retry.ok)
service.clearRecoveryTask(task.id)
check('恢复任务已清理', service.listRecoveryTasks().length === 0)

console.log(`\n结果：${pass} 通过，${fail} 失败`)
if (fail > 0) process.exit(1)
