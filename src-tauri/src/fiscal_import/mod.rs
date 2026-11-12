//! Local package selection and registration. Deliberately no activation API.
#[cfg(all(feature="fiscal-import-qa",not(debug_assertions)))]
compile_error!("The fiscal QA host cannot be compiled as a release artifact");
pub(crate) mod commands;
mod contracts;
mod service;
mod input;
pub(crate) mod host_context;
pub(crate) use service::ImportService;
pub(crate) use contracts::Owner;
pub(crate) use contracts::Error as ImportError;
use contracts::*;
use crate::fiscal_repository::{Repository,Policy,PreparedPreview,PreviewSummary,Detail,Receipt,InstallationMetadata};
use std::sync::Arc;
fn fail(code:&str)->Error{Error{code:code.into()}}
impl From<crate::fiscal_repository::RepositoryError> for Error{fn from(e:crate::fiscal_repository::RepositoryError)->Self{fail(e.code)}}
impl From<std::io::Error> for Error{fn from(e:std::io::Error)->Self{let e:crate::fiscal_repository::RepositoryError=e.into();e.into()}}
#[cfg(test)]mod tests;
