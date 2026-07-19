param([string]$ProjectRoot = (Join-Path $PSScriptRoot '..\Prueba Juego Online'))

Add-Type -AssemblyName System.Drawing

function New-StableGuid([string]$Text) {
    $md5 = [System.Security.Cryptography.MD5]::Create()
    try { return [Guid]::new($md5.ComputeHash([Text.Encoding]::UTF8.GetBytes($Text))).ToString() }
    finally { $md5.Dispose() }
}

function New-GokuSprite([string]$Name, [string]$Source, [int]$Frames, [int]$XOrigin, [int]$YOrigin) {
    $spriteDir = Join-Path $ProjectRoot "sprites\$Name"
    New-Item -ItemType Directory -Force -Path $spriteDir | Out-Null
    $sourceImage = [Drawing.Bitmap]::FromFile($Source)
    $frameWidth = [int]($sourceImage.Width / $Frames)
    $height = $sourceImage.Height
    $layerId = New-StableGuid "$Name-layer"
    $frameItems = @()
    $keyItems = @()

    for ($i = 0; $i -lt $Frames; $i++) {
        $frameId = New-StableGuid "$Name-frame-$i"
        $keyId = New-StableGuid "$Name-key-$i"
        $frame = New-Object Drawing.Bitmap $frameWidth, $height, ([Drawing.Imaging.PixelFormat]::Format32bppArgb)
        $graphics = [Drawing.Graphics]::FromImage($frame)
        $graphics.Clear([Drawing.Color]::Transparent)
        $src = New-Object Drawing.Rectangle ($i * $frameWidth), 0, $frameWidth, $height
        $dst = New-Object Drawing.Rectangle 0, 0, $frameWidth, $height
        $graphics.DrawImage($sourceImage, $dst, $src, [Drawing.GraphicsUnit]::Pixel)
        $graphics.Dispose()

        $composite = Join-Path $spriteDir "$frameId.png"
        $layerDir = Join-Path $spriteDir "layers\$frameId"
        New-Item -ItemType Directory -Force -Path $layerDir | Out-Null
        $frame.Save($composite, [Drawing.Imaging.ImageFormat]::Png)
        $frame.Save((Join-Path $layerDir "$layerId.png"), [Drawing.Imaging.ImageFormat]::Png)
        if ($i -eq 0) { $frame.Save((Join-Path $spriteDir "$Name.png"), [Drawing.Imaging.ImageFormat]::Png) }
        $frame.Dispose()

        $frameItems += [ordered]@{'$GMSpriteFrame'='v1';'%Name'=$frameId;name=$frameId;resourceType='GMSpriteFrame';resourceVersion='2.0'}
        $channel = [ordered]@{'$SpriteFrameKeyframe'='';Id=[ordered]@{name=$frameId;path="sprites/$Name/$Name.yy"};resourceType='SpriteFrameKeyframe';resourceVersion='2.0'}
        $keyItems += [ordered]@{'$Keyframe<SpriteFrameKeyframe>'='';Channels=[ordered]@{'0'=$channel};Disabled=$false;id=$keyId;IsCreationKey=$false;Key=[double]$i;Length=1.0;resourceType='Keyframe<SpriteFrameKeyframe>';resourceVersion='2.0';Stretch=$false}
    }
    $sourceImage.Dispose()

    $storeEvents = [ordered]@{'$KeyframeStore<MessageEventKeyframe>'='';Keyframes=@();resourceType='KeyframeStore<MessageEventKeyframe>';resourceVersion='2.0'}
    $storeMoments = [ordered]@{'$KeyframeStore<MomentsEventKeyframe>'='';Keyframes=@();resourceType='KeyframeStore<MomentsEventKeyframe>';resourceVersion='2.0'}
    $keyStore = [ordered]@{'$KeyframeStore<SpriteFrameKeyframe>'='';Keyframes=$keyItems;resourceType='KeyframeStore<SpriteFrameKeyframe>';resourceVersion='2.0'}
    $track = [ordered]@{'$GMSpriteFramesTrack'='';builtinName=0;events=@();inheritsTrackColour=$true;interpolation=1;isCreationTrack=$false;keyframes=$keyStore;modifiers=@();name='frames';resourceType='GMSpriteFramesTrack';resourceVersion='2.0';spriteId=$null;trackColour=0;tracks=@();traits=0}
    $sequence = [ordered]@{'$GMSequence'='v1';'%Name'=$Name;autoRecord=$true;backdropHeight=768;backdropImageOpacity=0.5;backdropImagePath='';backdropWidth=1366;backdropXOffset=0.0;backdropYOffset=0.0;events=$storeEvents;eventStubScript=$null;eventToFunction=[ordered]@{};length=[double]$Frames;lockOrigin=$false;moments=$storeMoments;name=$Name;playback=1;playbackSpeed=30.0;playbackSpeedType=0;resourceType='GMSequence';resourceVersion='2.0';showBackdrop=$true;showBackdropImage=$false;timeUnits=1;tracks=@($track);visibleRange=$null;volume=1.0;xorigin=$XOrigin;yorigin=$YOrigin}
    $sprite = [ordered]@{'$GMSprite'='v2';'%Name'=$Name;bboxMode=0;bbox_bottom=$($height-1);bbox_left=0;bbox_right=$($frameWidth-1);bbox_top=0;collisionKind=1;collisionTolerance=0;DynamicTexturePage=$false;edgeFiltering=$false;For3D=$false;frames=$frameItems;gridX=0;gridY=0;height=$height;HTile=$false;layers=@([ordered]@{'$GMImageLayer'='';'%Name'=$layerId;blendMode=0;displayName='default';isLocked=$false;name=$layerId;opacity=100.0;resourceType='GMImageLayer';resourceVersion='2.0';visible=$true});name=$Name;nineSlice=$null;origin=9;parent=[ordered]@{name='Sprites';path='folders/Sprites.yy'};preMultiplyAlpha=$false;resourceType='GMSprite';resourceVersion='2.0';sequence=$sequence;swatchColours=$null;swfPrecision=2.525;textureGroupId=[ordered]@{name='Default';path='texturegroups/Default'};type=0;VTile=$false;width=$frameWidth}
    $sprite | ConvertTo-Json -Depth 30 | Set-Content -LiteralPath (Join-Path $spriteDir "$Name.yy") -Encoding UTF8
}

$sourceDir = Join-Path $ProjectRoot 'datafiles\Goku'
New-GokuSprite 'spr_goku' (Join-Path $sourceDir 'Goku.png') 1 15 46
New-GokuSprite 'spr_goku_forward' (Join-Path $sourceDir 'Goku_forward.png') 1 16 46
New-GokuSprite 'spr_goku_backward' (Join-Path $sourceDir 'Goku_backward.png') 1 16 46
New-GokuSprite 'spr_goku_hurted' (Join-Path $sourceDir 'Goku_hurted.png') 1 19 50
New-GokuSprite 'spr_goku_combo' (Join-Path $sourceDir 'Goku_combo_strip.png') 3 15 46
New-GokuSprite 'spr_goku_vanish' (Join-Path $sourceDir 'Goku_vanish.png') 1 15 46
New-GokuSprite 'spr_goku_sideward_hurt' (Join-Path $sourceDir 'Goku_sideward_hurt.png') 1 19 50
New-GokuSprite 'spr_goku_downward_hurt' (Join-Path $sourceDir 'Goku_downward_hurt.png') 1 19 50
New-GokuSprite 'spr_goku_strong' (Join-Path $sourceDir 'Goku_strong_strip.png') 2 19 50
New-GokuSprite 'spr_goku_strong_high' (Join-Path $sourceDir 'Goku_upward_impact_strip.png') 2 18 46
New-GokuSprite 'spr_goku_strong_low' (Join-Path $sourceDir 'Goku_downward_impact_strip.png') 2 19 46
