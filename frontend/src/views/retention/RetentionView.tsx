import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'

import { downloadEntries, listEntries, moduleMeta, runAction as applyAction } from '@/api/local-service'
import { mappingsByRetention } from '@/api/mapping-link'
import type { EntryRow } from '@/data/types'

const meta = moduleMeta('retention')
const columns = [
  "方案编号",
  "方案名称",
  "初始事件",
  "回访事件",
  "观察天数",
  "群组粒度",
  "留存阈值",
  "关联产品"
]
const actions = [
  "提交方案评审",
  "启用方案",
  "归档方案"
]
const statuses = [
  "草稿",
  "方案评审中",
  "已启用",
  "已归档"
]
const stats = [
  {
    "label": "留存方案总数",
    "value": 0
  },
  {
    "label": "已启用方案",
    "value": 0
  },
  {
    "label": "方案评审中",
    "value": 0
  }
]

export default function RetentionView() {
  const [rows, setRows] = useState<EntryRow[]>([])
  const [total, setTotal] = useState(0)
  const [errorMessage, setErrorMessage] = useState('')
  const [filters, setFilters] = useState<Record<string, string>>({})
  const filterFields = useMemo(() => columns.slice(0, 3), [])

  const reload = useCallback(() => {
    setErrorMessage('')
    try {
      const payload = listEntries(meta.key, filters)
      setRows(payload.items)
      setTotal(payload.total)
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : '留存分析列表读取失败')
    }
  }, [filters])

  useEffect(() => {
    reload()
  }, [reload])

  function runAction(action: string, row: EntryRow) {
    setErrorMessage('')
    const result = applyAction(meta.key, Number(row.id), action)
    if (!result.ok) {
      setErrorMessage(result.message)
      return
    }
    reload()
  }

  return (
    <section className="page" data-module="retention">
      <header className="page-head">
        <div>
          <h2>留存分析管理</h2>
          <p className="page-desc">定义用户或业务的留存分析方案，按群组和周期追踪回访率和活跃度。</p>
        </div>
        <div className="page-actions">
          <Link className="btn primary" to="/benchmark-mapping">查看基准映射</Link>
          <button className="btn primary" type="button" onClick={() => setErrorMessage('留存方案登记入口尚未接入审批流')}>
            登记留存方案
          </button>
          <button className="btn" type="button" onClick={() => downloadEntries(meta.key)}>
            导出留存分析清单
          </button>
        </div>
      </header>

      <div className="stat-row">
        {stats.map((item) => (
          <article key={item.label} className="stat-card">
            <span className="stat-label">{item.label}</span>
            <strong className="stat-value">{item.value}</strong>
          </article>
        ))}
      </div>

      <p className="status-legend">
        {statuses.map((status: string) => (
          <span key={status} className="legend-item">
            {status}：{rows.filter((row) => String(row.status) === status).length}
          </span>
        ))}
      </p>

      <form className="filter-bar" onSubmit={(event) => { event.preventDefault(); reload() }}>
        {filterFields.map((field) => (
          <label key={field} className="filter-item">
            <span>{field}</span>
            <input
              value={filters[field] ?? ''}
              placeholder={`按${field}检索`}
              onChange={(event) => setFilters((prev) => ({ ...prev, [field]: event.target.value }))}
            />
          </label>
        ))}
        <button className="btn" type="submit">查询</button>
        <button className="btn ghost" type="button" onClick={() => setFilters({})}>重置条件</button>
      </form>

      <table className="data-table">
        <thead>
          <tr>
            {columns.map((column) => <th key={column}>{column}</th>)}
            <th>基准映射</th>
            <th>当前状态</th>
            <th>可执行动作</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const linked = mappingsByRetention(String(row['方案编号']))
            return (
            <tr key={String(row.id)}>
              {columns.map((column) => <td key={column}>{row[column] ?? '—'}</td>)}
              <td>
                {linked.length === 0 ? (
                  <span className="cell-sub">未映射</span>
                ) : (
                  linked.map((item) => (
                    <span key={item.id} className={`tag tag-${item.status}`} style={{ marginRight: 4 }}>
                      {item.mappingNo}｜{item.candidateThresholdText}｜{item.status}
                    </span>
                  ))
                )}
                <div><Link className="link" to="/benchmark-mapping">管理映射</Link></div>
              </td>
              <td>{row.status}</td>
              <td className="row-actions">
                {actions.map((action) => (
                  <button key={action} className="link" type="button" onClick={() => runAction(action, row)}>
                    {action}
                  </button>
                ))}
              </td>
            </tr>
            )
          })}
          {rows.length === 0 && (
            <tr>
              <td className="empty-state" colSpan={columns.length + 3}>暂无留存分析数据，可先登记留存方案</td>
            </tr>
          )}
        </tbody>
      </table>

      <footer className="page-foot">
        <span>共 {total} 条留存分析记录</span>
        {errorMessage && <span className="error-text">{errorMessage}</span>}
      </footer>
    </section>
  )
}
