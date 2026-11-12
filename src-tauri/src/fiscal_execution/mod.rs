//! Per-request, RAM-only authority. No salary persistence or document producer.
pub(crate) mod commands;
mod contracts;
mod json;
mod service;
mod document;
pub(crate) use service::ExecutionService;
pub(crate) use service::finalization::{DocumentPermit,FinalizationResponse,AuthorityReference};
use contracts::*;
use crate::fiscal_import::{ImportService,Owner};
use crate::fiscal_repository::{ExecutionContext,SelectionIdentity,DocumentContract};
use std::sync::Arc;
fn fail(code:&str)->Error{Error{code:code.into()}}
impl From<crate::fiscal_repository::RepositoryError> for Error{fn from(e:crate::fiscal_repository::RepositoryError)->Self{fail(e.code)}}
impl From<crate::fiscal_import::ImportError> for Error{fn from(e:crate::fiscal_import::ImportError)->Self{fail(&e.code)}}
impl From<crate::storage::StoreError> for Error{fn from(e:crate::storage::StoreError)->Self{fail(&e.code)}}
#[cfg(test)]mod tests;
