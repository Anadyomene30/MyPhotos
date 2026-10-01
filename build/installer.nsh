; Family sharing: allow incoming connections on the local network only (private profile), port 47810.
!macro customInstall
  nsExec::Exec 'netsh advfirewall firewall delete rule name="MyPhotos - partage familial"'
  nsExec::Exec 'netsh advfirewall firewall add rule name="MyPhotos - partage familial" dir=in action=allow protocol=TCP localport=47810 profile=private'
!macroend

!macro customUnInstall
  nsExec::Exec 'netsh advfirewall firewall delete rule name="MyPhotos - partage familial"'
!macroend
