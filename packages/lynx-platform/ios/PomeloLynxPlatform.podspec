Pod::Spec.new do |s|
  s.name = 'PomeloLynxPlatform'
  s.version = '0.1.0'
  s.summary = 'Pomelo Lynx generic platform native library'
  s.homepage = 'https://github.com/rangdl/pomelo-lynx'
  s.license = { :type => 'Apache-2.0' }
  s.author = 'Pomelo'
  s.platform = :ios, '15.0'
  s.source = { :path => '.' }
  s.source_files = 'src/**/*.swift'
  s.swift_version = '5.0'
  s.dependency 'Lynx'
end
