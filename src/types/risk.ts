export type RiskLevel = 'low' | 'medium' | 'high'

export interface AtRiskStudent {
  id: string
  name: string
  reasons: string[]
  riskLevel: RiskLevel
}
