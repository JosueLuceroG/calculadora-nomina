//! Selection/admission only. Does not expose fiscal material or salary execution.
pub(crate) mod commands;
mod contracts;
mod service;
pub(crate) use service::ActivationService;
use contracts::*;
use crate::fiscal_import::{ImportService,Owner};
use crate::fiscal_repository::{ActivationIntent,ActivationPreview,Eligibility,Receipt,SelectionIdentity,SelectionStatus,EXECUTION_CLOSED};
use std::sync::Arc;
fn error(code:&str)->Error{Error{code:code.into()}}
impl From<crate::fiscal_repository::RepositoryError> for Error{fn from(e:crate::fiscal_repository::RepositoryError)->Self{error(e.code)}}
#[cfg(test)]mod tests;
