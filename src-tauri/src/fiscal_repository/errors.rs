use serde::Serialize;
#[derive(Debug,Clone,Serialize)]
pub struct Error { pub code:&'static str, pub core_code:Option<&'static str> }
pub type Result<T> = std::result::Result<T,Error>;
pub fn fail(code:&'static str)->Error{Error{code,core_code:None}}
impl From<nomina_fiscal_package::errors::Failure> for Error{fn from(e:nomina_fiscal_package::errors::Failure)->Self{Self{code:e.code,core_code:Some(e.code)}}}
impl From<std::io::Error> for Error{fn from(e:std::io::Error)->Self{fail(match e.raw_os_error(){Some(5)=>"ACCESS_DENIED",Some(32)|Some(33)=>"SHARING_VIOLATION",Some(39)|Some(112)=>"DISK_FULL",_=>match e.kind(){std::io::ErrorKind::PermissionDenied=>"ACCESS_DENIED",std::io::ErrorKind::NotFound=>"MISSING",std::io::ErrorKind::StorageFull=>"DISK_FULL",_=>"IO_ERROR"}})}}
impl From<rusqlite::Error> for Error{fn from(e:rusqlite::Error)->Self{use rusqlite::ErrorCode::*;fail(match e.sqlite_error_code(){Some(DatabaseCorrupt)|Some(NotADatabase)=>"CORRUPT_DATABASE",Some(DatabaseBusy)|Some(DatabaseLocked)=>"BUSY",Some(DiskFull)=>"DISK_FULL",Some(PermissionDenied)|Some(ReadOnly)=>"ACCESS_DENIED",_=>"DATABASE_ERROR"})}}
