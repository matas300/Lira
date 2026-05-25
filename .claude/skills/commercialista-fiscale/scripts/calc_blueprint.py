from dataclasses import dataclass

@dataclass
class TaxScenario:
    year: int
    regime: str
    revenue: float
    profitability_ratio: float | None = None
    deductible_contributions_paid: float = 0.0
    substitute_tax_rate: float | None = None
    real_costs: float = 0.0
    personal_income_tax_estimate: float = 0.0
    previdential_contributions: float = 0.0


def compute_forfettario(s: TaxScenario) -> dict:
    if s.profitability_ratio is None or s.substitute_tax_rate is None:
        raise ValueError("profitability_ratio and substitute_tax_rate are required")
    gross_forfettario_income = s.revenue * s.profitability_ratio
    taxable_income = gross_forfettario_income - s.deductible_contributions_paid
    substitute_tax = taxable_income * s.substitute_tax_rate
    net_income = s.revenue - s.previdential_contributions - substitute_tax
    return {
        "gross_forfettario_income": gross_forfettario_income,
        "taxable_income": taxable_income,
        "substitute_tax": substitute_tax,
        "previdential_contributions": s.previdential_contributions,
        "net_income": net_income,
    }


def compute_ordinario(s: TaxScenario) -> dict:
    taxable_income = s.revenue - s.real_costs
    net_income = s.revenue - s.real_costs - s.personal_income_tax_estimate - s.previdential_contributions
    return {
        "taxable_income": taxable_income,
        "personal_income_tax_estimate": s.personal_income_tax_estimate,
        "previdential_contributions": s.previdential_contributions,
        "net_income": net_income,
    }
