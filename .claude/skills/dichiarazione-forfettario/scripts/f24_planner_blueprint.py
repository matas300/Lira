from dataclasses import dataclass

@dataclass
class F24Plan:
    tax_year: int
    declaration_year: int
    tax_due: float
    previdential_due: float
    previous_payments: float = 0.0


def build_summary(plan: F24Plan) -> dict:
    residual = plan.tax_due + plan.previdential_due - plan.previous_payments
    return {
        "tax_year": plan.tax_year,
        "declaration_year": plan.declaration_year,
        "tax_due": plan.tax_due,
        "previdential_due": plan.previdential_due,
        "previous_payments": plan.previous_payments,
        "residual": residual,
    }
