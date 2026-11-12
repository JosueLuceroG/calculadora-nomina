param([Parameter(Mandatory=$true)][string]$Root)
$ErrorActionPreference='Stop'
$p=[IO.Path]::GetFullPath($Root)
if (-not $p.StartsWith([IO.Path]::Combine($env:TEMP,'opencode')+[IO.Path]::DirectorySeparatorChar) -or -not ([IO.Path]::GetFileName($p)).StartsWith('5b7-5d3b2-')) { throw 'Isolated QA root required' }
$file=[IO.FileStream]::new([IO.Path]::Combine($p,'.fiscal-maintenance.lock'),[IO.FileMode]::Open,[IO.FileAccess]::ReadWrite,[IO.FileShare]::ReadWrite)
try {$file.Lock(0,1);[Console]::WriteLine('QA_LOCK_READY');[Console]::Out.Flush();[void][Console]::ReadLine();$file.Unlock(0,1)}finally{$file.Dispose()}
