Pod::Spec.new do |s|
  s.name           = 'Scan3dAr'
  s.version        = '1.0.0'
  s.summary        = 'Scan3D : caméra ARKit, nuage de points et images clés'
  s.description    = 'Module local Scan3D (ARKit, sans LiDAR obligatoire).'
  s.author         = ''
  s.homepage       = 'https://docs.expo.dev/modules/'
  s.platforms      = {
    :ios => '16.4'
  }
  s.swift_version  = '5.9'
  s.source         = { git: '' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'
  s.frameworks = 'ARKit', 'SceneKit', 'CoreImage'

  # Swift/Objective-C compatibility
  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
  }

  s.source_files = "**/*.{h,m,mm,swift,hpp,cpp}"
end
