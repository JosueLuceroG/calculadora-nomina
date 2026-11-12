use super::*;
use std::{fs::OpenOptions,io::Read,path::{Path,Component,Prefix}};
pub fn read_selected(path:&Path,max:usize)->Result<Vec<u8>>{
    if !path.is_absolute()||path.components().any(|p|matches!(p,Component::ParentDir)){return Err(fail("LOCAL_FILE_REQUIRED"));}
    #[cfg(windows)]{
        use std::os::windows::{fs::OpenOptionsExt,io::AsRawHandle};use windows_sys::Win32::Storage::FileSystem::*;
        let drive=match path.components().next(){Some(Component::Prefix(p))=>match p.kind(){Prefix::Disk(d)|Prefix::VerbatimDisk(d)=>d,_=>return Err(fail("LOCAL_FILE_REQUIRED"))},_=>return Err(fail("LOCAL_FILE_REQUIRED"))};let d:Vec<u16>=format!("{}:\\",drive as char).encode_utf16().chain(Some(0)).collect();if unsafe{GetDriveTypeW(d.as_ptr())}==4{return Err(fail("LOCAL_FILE_REQUIRED"));}
        let mut file=OpenOptions::new().read(true).share_mode(1).custom_flags(FILE_FLAG_OPEN_REPARSE_POINT|FILE_FLAG_OPEN_NO_RECALL).open(path)?;let handle=file.as_raw_handle();let mut info:BY_HANDLE_FILE_INFORMATION=unsafe{std::mem::zeroed()};if unsafe{GetFileInformationByHandle(handle,&mut info)}==0{return Err(std::io::Error::last_os_error().into());}
        if unsafe{GetFileType(handle)}!=FILE_TYPE_DISK||info.nNumberOfLinks!=1||info.dwFileAttributes&(FILE_ATTRIBUTE_DIRECTORY|FILE_ATTRIBUTE_REPARSE_POINT|FILE_ATTRIBUTE_OFFLINE|FILE_ATTRIBUTE_RECALL_ON_OPEN|FILE_ATTRIBUTE_RECALL_ON_DATA_ACCESS)!=0{return Err(fail("REGULAR_LOCAL_FILE_REQUIRED"));}
        let mut actual=vec![0u16;32768];let n=unsafe{GetFinalPathNameByHandleW(handle,actual.as_mut_ptr(),actual.len() as u32,0)};if n==0||n as usize>=actual.len(){return Err(fail("LOCAL_FILE_REQUIRED"));}let actual=std::path::PathBuf::from(String::from_utf16_lossy(&actual[..n as usize]));for parent in actual.ancestors().skip(1){use std::os::windows::fs::MetadataExt;if std::fs::symlink_metadata(parent)?.file_attributes()&FILE_ATTRIBUTE_REPARSE_POINT!=0{return Err(fail("REGULAR_LOCAL_FILE_REQUIRED"));}}
        let mut bytes=Vec::new();(&mut file).take(max as u64+1).read_to_end(&mut bytes)?;if bytes.is_empty()||bytes.len()>max{return Err(fail("INPUT_LIMIT"));}return Ok(bytes);
    }
    #[cfg(not(windows))]{let mut f=OpenOptions::new().read(true).open(path)?;let mut b=vec![];(&mut f).take(max as u64+1).read_to_end(&mut b)?;if b.is_empty()||b.len()>max{return Err(fail("INPUT_LIMIT"));}Ok(b)}
}
