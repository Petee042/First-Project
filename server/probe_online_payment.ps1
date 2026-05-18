$base = "https://automaticpeople.com/api/public/shared-resources"
$matches = @()

for ($id = 1; $id -le 120; $id++) {
    $url = "$base/$id"
    $status = -1
    $body = ""

    try {
        $r = Invoke-WebRequest -UseBasicParsing -Uri $url -Headers @{ Accept = "application/json" } -Method GET -ErrorAction Stop
        $status = [int]$r.StatusCode
        $body = $r.Content
    } catch {
        if ($_.Exception.Response) {
            $resp = $_.Exception.Response
            $status = [int]$resp.StatusCode
            $reader = New-Object System.IO.StreamReader($resp.GetResponseStream())
            $body = $reader.ReadToEnd()
            $reader.Close()
        }
    }

    $j = $null
    try { $j = $body | ConvertFrom-Json -ErrorAction Stop } catch { $j = $null }
    if (-not $j) { continue }

    $resObj = $null
    if ($j.PSObject.Properties.Name -contains "resource") {
        $resObj = $j.resource
    } elseif (($j.PSObject.Properties.Name -contains "data") -and $j.data) {
        if ($j.data.PSObject.Properties.Name -contains "resource") { $resObj = $j.data.resource } else { $resObj = $j.data }
    } else {
        $resObj = $j
    }

    if (-not $resObj) { continue }
    $props = @($resObj.PSObject.Properties.Name)
    if (($props -contains "online_payment") -and (($props -contains "short_description") -or ($props -contains "resource_type"))) {
        $sd = $null
        $rt = $null
        if ($props -contains "short_description") { $sd = $resObj.short_description }
        if ($props -contains "resource_type") { $rt = $resObj.resource_type }
        $matches += [pscustomobject]@{
            id = $id
            status = $status
            online_payment = $resObj.online_payment
            short_description = $sd
            resource_type = $rt
        }
    }
}

"FOUND_IDS:"
if ($matches.Count -eq 0) {
    "None found in IDs 1..120"
    exit 0
}
$matches | Sort-Object id | Format-Table -AutoSize

$target = $matches | Where-Object { $_.online_payment -eq $true } | Select-Object -First 1
if (-not $target) {
    "No resource with online_payment=true found; skipping prepare call."
    exit 0
}

"PREPARE_TARGET_ID: $($target.id)"
$payload = @{
    paymentOption = "online_payment"
    checkinDate = "2026-08-10"
    checkoutDate = "2026-08-11"
    requestedStartAt = "2026-08-10T10:00:00Z"
    requestedEndAt = "2026-08-10T12:00:00Z"
    spacesRequired = 1
    reservationAmount = 10.5
    firstName = "Test"
    familyName = "User"
    emailAddress = "test@example.com"
    telephone = "07000000000"
    vehicleRegistration = "AB12CDE"
} | ConvertTo-Json

$prepareUrl = "$base/$($target.id)/online-payment/prepare"
$pStatus = -1
$pBody = ""
try {
    $pr = Invoke-WebRequest -UseBasicParsing -Uri $prepareUrl -Method POST -Headers @{ Accept = "application/json"; "Content-Type" = "application/json" } -Body $payload -ErrorAction Stop
    $pStatus = [int]$pr.StatusCode
    $pBody = $pr.Content
} catch {
    if ($_.Exception.Response) {
        $resp = $_.Exception.Response
        $pStatus = [int]$resp.StatusCode
        $reader = New-Object System.IO.StreamReader($resp.GetResponseStream())
        $pBody = $reader.ReadToEnd()
        $reader.Close()
    } else {
        $pBody = $_.Exception.Message
    }
}

"PREPARE_STATUS: $pStatus"
$pj = $null
try { $pj = $pBody | ConvertFrom-Json -ErrorAction Stop } catch { $pj = $null }
if ($pj) {
    "PREPARE_KEYS: $($pj.PSObject.Properties.Name -join ', ')"
    $pj | Select-Object id,status,message,success,clientSecret,paymentIntentId,reservationId,error | Format-List
} else {
    "PREPARE_RAW_BODY:"
    $pBody
}
