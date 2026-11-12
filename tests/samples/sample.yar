import "pe"

rule Suspicious_Loader : loader windows
{
    meta:
        author = "Treelights sample"
        description = "Fictional rule for highlighting tests"
        score = 75

    strings:
        $mz = { 4D 5A ?? 00 [2-4] 50 45 }
        $s1 = "cmd.exe /c" nocase wide ascii
        $s2 = "\\AppData\\Roaming\\" fullword
        $re = /https?:\/\/[a-z0-9.]+\/gate\.php/

    condition:
        $mz at 0 and filesize < 2MB and
        (any of ($s*) or #s1 > 2) and not $re
}

private global rule Always_True { condition: true }
