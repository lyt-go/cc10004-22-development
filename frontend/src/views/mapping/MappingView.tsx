import { useCallback, useEffect, useMemo, useState } from 'react'

import {
  applyBenchmarkDrift,
  clearRecoveryTask,
  confirmPrimary,
  enableMapping,
  generateMapping,
  listRecoveryTasks,
  mappingOptions,
  resetMappings,
  resolveReview,
  saveRecoveryTask,
} from '@/api/mapping-service'
import { listMappings } from '@/data/mapping-store'
import type { MappingRecord, MappingStatus, RecoveryTask } from '@/data/mapping-types'

const STATUS_FLOW: MappingStatus[] = ['待确认', '已启用', '待复核', '映射失败']

type FaultMode = 'normal' | 'fault'

export default function MappingView() {
  const [rows, setRows] = useState<MappingRecord[]>([])
  const [tasks, setTasks] = useState<RecoveryTask[]>([])
  const [notice, setNotice] = useState('')
  const [errorMessage, setErrorMessage] = useState('')
  const [faultMode, setFaultMode] = useState<FaultMode>('normal')

  const options = useMemo(() => mappingOptions(), [rows])
  const [benchmarkNo, setBenchmarkNo] = useState('')
  const [retentionNo, setRetentionNo] = useState('')
  const [metric, setMetric] = useState('')
  const [initialEvent, setInitialEvent] = useState('')
  const [driftNo, setDriftNo] = useState('BENC-0002')
  const [driftValue, setDriftValue] = useState('47%')

  const selectedBenchmark = options.benchmarks.find((item) => item.no === benchmarkNo)
  const selectedRetention = options.retentions.find((item) => item.no === retentionNo)

  const reload = useCallback(() => {
    try {
      setRows(listMappings())
      setTasks(listRecoveryTasks())
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : '映射数据读取失败')
    }
  }, [])

  useEffect(() => {
    reload()
  }, [reload])

  // 选择对标方案时自动带出对比指标，减少手工错配。
  useEffect(() => {
    if (selectedBenchmark) {
      setMetric(selectedBenchmark.metric)
    }
  }, [benchmarkNo]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (selectedRetention) {
      setInitialEvent(selectedRetention.initialEvent)
    }
  }, [retentionNo]) // eslint-disable-line react-hooks/exhaustive-deps

  function handleGenerate() {
    setNotice('')
    setErrorMessage('')
    if (!benchmarkNo || !retentionNo) {
      setErrorMessage('请先选择对标方案和留存方案')
      return
    }
    // 故障演练开关：模拟生成接口中断，落恢复任务，验证重试与中断恢复。
    if (faultMode === 'fault') {
      const task = saveRecoveryTask({
        benchmarkNo,
        retentionNo,
        stage: '候选阈值计算',
        reason: '模拟故障：映射生成服务在候选阈值计算阶段中断（网络异常或服务超时）',
      })
      setTasks(listRecoveryTasks())
      setErrorMessage(`映射生成中断，已记录恢复任务 #${task.id}，可在下方「中断恢复」区重试。异常原因：${task.reason}`)
      return
    }
    const result = generateMapping({ benchmarkNo, retentionNo, metric, initialEvent })
    if (!result.ok) {
      setErrorMessage(result.message)
    } else {
      setNotice(result.message)
    }
    reload()
  }

  function handleRetry(task: RecoveryTask) {
    setErrorMessage('')
    setNotice('')
    if (faultMode === 'fault') {
      setErrorMessage(`恢复任务 #${task.id} 重试仍失败：故障演练开关未关闭，请先切回「正常模式」后重试`)
      return
    }
    const result = generateMapping({
      benchmarkNo: task.benchmarkNo,
      retentionNo: task.retentionNo,
      metric: options.benchmarks.find((item) => item.no === task.benchmarkNo)?.metric ?? '',
      initialEvent: options.retentions.find((item) => item.no === task.retentionNo)?.initialEvent ?? '',
    })
    if (result.ok) {
      clearRecoveryTask(task.id)
      setNotice(`恢复任务 #${task.id} 重试成功：${result.message}`)
    } else {
      setErrorMessage(`恢复任务 #${task.id} 重试失败：${result.message}`)
    }
    reload()
  }

  function handlePrimary(row: MappingRecord) {
    setErrorMessage('')
    const result = confirmPrimary(row.id)
    if (!result.ok) {
      setErrorMessage(result.message)
    } else {
      setNotice(result.message)
    }
    reload()
  }

  function handleEnable(row: MappingRecord) {
    setErrorMessage('')
    const result = enableMapping(row.id)
    if (!result.ok) {
      setErrorMessage(result.message)
    } else {
      setNotice(result.message)
    }
    reload()
  }

  function handleDrift() {
    setErrorMessage('')
    const result = applyBenchmarkDrift(driftNo, driftValue)
    if (!result.ok) {
      setErrorMessage(result.message)
    } else {
      setNotice(result.message)
    }
    reload()
  }

  function handleResolve(row: MappingRecord, adoptLatest: boolean) {
    setErrorMessage('')
    const result = resolveReview(row.id, adoptLatest)
    if (!result.ok) {
      setErrorMessage(result.message)
    } else {
      setNotice(result.message)
    }
    reload()
  }

  function handleReset() {
    resetMappings()
    setNotice('映射数据已重置为初始样例（BMAP-0001：BENC-0002 → RETE-0002）')
    setErrorMessage('')
    reload()
  }

  const statCards = [
    { label: '映射总数', value: rows.length },
    { label: '待确认主对标', value: rows.filter((row) => row.status === '待确认').length },
    { label: '已启用（版本已锁定）', value: rows.filter((row) => row.status === '已启用').length },
    { label: '待复核', value: rows.filter((row) => row.status === '待复核').length },
    { label: '映射失败', value: rows.filter((row) => row.status === '映射失败').length },
  ]

  return (
    <section className="page" data-module="benchmark-mapping">
      <header className="page-head">
        <div>
          <h2>基准映射管理</h2>
          <p className="page-desc">
            为每个对标方案选择对比指标、基准值与适用初始事件，生成留存方案的候选阈值与预计留存差距；
            启用即固定对标版本，基准再变化只触发待复核。差值容限统一为 4 个百分点。
          </p>
        </div>
        <div className="page-actions">
          <button className="btn ghost" type="button" onClick={handleReset}>重置映射样例</button>
        </div>
      </header>

      <div className="stat-row">
        {statCards.map((card) => (
          <article key={card.label} className="stat-card">
            <span className="stat-label">{card.label}</span>
            <strong className="stat-value">{card.value}</strong>
          </article>
        ))}
      </div>

      <p className="status-legend">
        {STATUS_FLOW.map((status) => (
          <span key={status} className="legend-item">
            {status}：{rows.filter((row) => row.status === status).length}
          </span>
        ))}
      </p>

      <div className="mapping-panel">
        <h3>新建基准映射</h3>
        <div className="mapping-form">
          <label className="filter-item">
            <span>对标方案（对比指标 / 基准值）</span>
            <select value={benchmarkNo} onChange={(event) => setBenchmarkNo(event.target.value)}>
              <option value="">请选择对标方案</option>
              {options.benchmarks.map((item) => (
                <option key={item.no} value={item.no}>
                  {item.no}｜{item.name}｜{item.metric}｜基准 {item.baseline}｜{item.cycle}
                </option>
              ))}
            </select>
          </label>
          <label className="filter-item">
            <span>留存方案（初始事件）</span>
            <select value={retentionNo} onChange={(event) => setRetentionNo(event.target.value)}>
              <option value="">请选择留存方案</option>
              {options.retentions.map((item) => (
                <option key={item.no} value={item.no}>
                  {item.no}｜{item.name}｜初始事件 {item.initialEvent}
                </option>
              ))}
            </select>
          </label>
          <label className="filter-item">
            <span>对比指标</span>
            <input value={metric} placeholder="随对标方案自动带出，可核对" onChange={(event) => setMetric(event.target.value)} />
          </label>
          <label className="filter-item">
            <span>适用初始事件</span>
            <input value={initialEvent} placeholder="随留存方案自动带出，可核对" onChange={(event) => setInitialEvent(event.target.value)} />
          </label>
        </div>
        <div className="mapping-form-foot">
          <label className="fault-switch">
            <input
              type="checkbox"
              checked={faultMode === 'fault'}
              onChange={(event) => setFaultMode(event.target.checked ? 'fault' : 'normal')}
            />
            故障演练（模拟生成中断，验证失败重试与中断恢复）
          </label>
          <button className="btn primary" type="button" onClick={handleGenerate}>生成候选阈值与留存差距</button>
        </div>
        {selectedBenchmark && selectedRetention && (
          <p className="mapping-preview">
            预检：{selectedBenchmark.no} 基准 {selectedBenchmark.baseline}（{selectedBenchmark.cycle} / {selectedBenchmark.source}）
            ，映射到 {selectedRetention.no} 初始事件「{selectedRetention.initialEvent}」，
            候选阈值 = 基准值 − 4 个百分点，候选阈值与预计留存差距将同时生成。
          </p>
        )}
      </div>

      <div className="mapping-panel">
        <h3>映射清单</h3>
        <table className="data-table">
          <thead>
            <tr>
              <th>映射编号</th>
              <th>对标方案 / 对比指标</th>
              <th>基准值（来源/周期）</th>
              <th>留存方案 / 初始事件</th>
              <th>候选阈值</th>
              <th>预计留存差距</th>
              <th>主对标</th>
              <th>锁定版本 / 复核信息</th>
              <th>状态</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id} className={row.status === '映射失败' ? 'row-failed' : row.status === '待复核' ? 'row-review' : ''}>
                <td>{row.mappingNo}</td>
                <td>{row.benchmarkNo}<br /><span className="cell-sub">{row.metric}</span></td>
                <td>{row.baselineText || '—'}<br /><span className="cell-sub">{row.sourceRef} / {row.collectCycle || '—'}</span></td>
                <td>{row.retentionNo}<br /><span className="cell-sub">{row.initialEvent || '—'}</span></td>
                <td><strong>{row.candidateThresholdText}</strong></td>
                <td>
                  {row.status === '映射失败' ? '—' : `${row.estimatedGap} 个百分点`}
                  <br /><span className="cell-sub">容限 {row.gapTolerance} 个百分点</span>
                </td>
                <td>
                  {row.primaryConfirmed ? <span className="tag tag-primary">主对标已确认</span> : <span className="tag tag-muted">未确认</span>}
                </td>
                <td className="cell-narrow">
                  {row.lockedBenchmarkVersion
                    ? (<><span className="cell-sub">锁定：{row.lockedBenchmarkVersion}</span><br /><span className="cell-sub">{row.lockedAt}</span></>)
                    : <span className="cell-sub">启用时固定版本</span>}
                  {row.reviewReason && <p className="review-reason">{row.reviewReason}</p>}
                  {row.failReason && <p className="fail-reason">异常原因：{row.failReason}</p>}
                </td>
                <td><span className={`tag tag-${row.status}`}>{row.status}</span></td>
                <td className="row-actions cell-narrow">
                  {row.status === '映射失败' && (
                    <button className="link" type="button" onClick={() => { setBenchmarkNo(row.benchmarkNo); setRetentionNo(row.retentionNo); setMetric(row.metric); setInitialEvent(row.initialEvent); setErrorMessage(`映射 ${row.mappingNo} 失败：${row.failReason}，请修正上方表单后重新生成`) }}>
                      修正后重试
                    </button>
                  )}
                  {(row.status === '待确认') && (
                    <>
                      <button className="link" type="button" onClick={() => handlePrimary(row)}>确认主对标</button>
                      <button className="link" type="button" onClick={() => handleEnable(row)}>启用映射</button>
                    </>
                  )}
                  {row.status === '已启用' && <span className="cell-sub">版本锁定中</span>}
                  {row.status === '待复核' && (
                    <>
                      <button className="link" type="button" onClick={() => handleResolve(row, true)}>采纳新基准复核</button>
                      <button className="link" type="button" onClick={() => handleResolve(row, false)}>维持原版本</button>
                    </>
                  )}
                </td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td className="empty-state" colSpan={10}>
                  <div className="empty-block">
                    <strong>暂无基准映射数据</strong>
                    <span>请在上方选择对标方案与留存方案，生成候选阈值与预计留存差距</span>
                  </div>
                </td>
              </tr>
            )}
          </tbody>
        </table>
        {rows.some((row) => row.conclusion) && (
          <div className="conclusion-list">
            <h4>对标结论（同时引用基准值与留存结果）</h4>
            {rows.filter((row) => row.conclusion).map((row) => (
              <p key={row.id} className="conclusion-item">
                <span className="tag tag-muted">{row.mappingNo}</span> {row.conclusion}
              </p>
            ))}
          </div>
        )}
      </div>

      <div className="mapping-panel">
        <h3>竞品基准变化演练（验证：只触发待复核，不改已启用方案）</h3>
        <div className="mapping-form-foot">
          <label className="filter-item">
            <span>对标方案</span>
            <select value={driftNo} onChange={(event) => setDriftNo(event.target.value)}>
              {options.benchmarks.map((item) => (
                <option key={item.no} value={item.no}>{item.no}｜{item.name}｜当前基准 {item.baseline}</option>
              ))}
            </select>
          </label>
          <label className="filter-item">
            <span>新基准值</span>
            <input value={driftValue} onChange={(event) => setDriftValue(event.target.value)} placeholder="如 47%" />
          </label>
          <button className="btn" type="button" onClick={handleDrift}>推送基准更新</button>
        </div>
        <p className="mapping-preview">
          规则：已启用映射固定的对标版本与留存阈值不会被改写；漂移超过 4 个百分点容限只转入「待复核」，由人工决定采纳或维持。
        </p>
      </div>

      <div className="mapping-panel">
        <h3>中断恢复</h3>
        {tasks.length === 0 ? (
          <p className="empty-inline">当前没有中断的映射任务，生成流程正常。</p>
        ) : (
          <table className="data-table">
            <thead>
              <tr><th>任务#</th><th>对标方案</th><th>留存方案</th><th>中断阶段</th><th>异常原因</th><th>中断时间</th><th>操作</th></tr>
            </thead>
            <tbody>
              {tasks.map((task) => (
                <tr key={task.id} className="row-failed">
                  <td>{task.id}</td>
                  <td>{task.benchmarkNo}</td>
                  <td>{task.retentionNo}</td>
                  <td>{task.stage}</td>
                  <td className="fail-reason">{task.reason}</td>
                  <td>{task.createdAt}</td>
                  <td className="row-actions">
                    <button className="link" type="button" onClick={() => handleRetry(task)}>重试</button>
                    <button className="link" type="button" onClick={() => { clearRecoveryTask(task.id); reload() }}>放弃</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <footer className="page-foot">
        <span>共 {rows.length} 条映射记录，数据保存在本机浏览器</span>
        {notice && <span className="notice-text">{notice}</span>}
        {errorMessage && <span className="error-text">{errorMessage}</span>}
      </footer>
    </section>
  )
}
