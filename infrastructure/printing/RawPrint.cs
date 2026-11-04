using System;
using System.IO;
using System.Text;
using System.Collections.Generic;
using System.Management;
using System.Linq;
using System.Runtime.InteropServices;
using System.Web.Script.Serialization;
// Source for a bounded, headless LocalService helper. It owns no database.
public static class RawPrint {
 [StructLayout(LayoutKind.Sequential,CharSet=CharSet.Unicode)] public class DOCINFO { [MarshalAs(UnmanagedType.LPWStr)] public string pDocName; [MarshalAs(UnmanagedType.LPWStr)] public string pOutputFile=null; [MarshalAs(UnmanagedType.LPWStr)] public string pDataType="RAW"; }
 [DllImport("winspool.drv",SetLastError=true,CharSet=CharSet.Unicode)] static extern bool OpenPrinter(string name,out IntPtr handle,IntPtr defaults);
 [DllImport("winspool.drv",SetLastError=true,CharSet=CharSet.Unicode)] static extern int StartDocPrinter(IntPtr h,int level,[In] DOCINFO info);
 [DllImport("winspool.drv",SetLastError=true)] static extern bool StartPagePrinter(IntPtr h);
 [DllImport("winspool.drv",SetLastError=true)] static extern bool WritePrinter(IntPtr h,byte[] data,int count,out int written);
 [DllImport("winspool.drv",SetLastError=true)] static extern bool EndPagePrinter(IntPtr h);
 [DllImport("winspool.drv",SetLastError=true)] static extern bool EndDocPrinter(IntPtr h);
 [DllImport("winspool.drv",SetLastError=true)] static extern bool ClosePrinter(IntPtr h);
 static JavaScriptSerializer json=new JavaScriptSerializer();
 static void Emit(object value){Console.Out.WriteLine(json.Serialize(value));Console.Out.Flush();}
 static List<Dictionary<string,object>> Printers(){var list=new List<Dictionary<string,object>>();using(var search=new ManagementObjectSearcher("SELECT Name,DriverName,PortName,PNPDeviceID FROM Win32_Printer")){foreach(ManagementObject p in search.Get())list.Add(new Dictionary<string,object>{{"queueName",p["Name"]},{"driverName",p["DriverName"]},{"portName",p["PortName"]},{"hardwareId",p["PNPDeviceID"]??""}});}return list;}
 public static int Main(string[] args){IntPtr handle=IntPtr.Zero;bool started=false;int job=0,total=0;try{
  if(args.Length!=1)throw new Exception();var stream=Console.OpenStandardInput();var reader=new BinaryReader(stream);int size=reader.ReadInt32();if(size<2||size>16384)throw new Exception();var metadata=json.Deserialize<Dictionary<string,object>>(Encoding.UTF8.GetString(reader.ReadBytes(size)));
  if(args[0]=="list"){Emit(new {printers=Printers()});return 0;}
  if(args[0]!="send")throw new Exception();string queue=(string)metadata["queueName"],driver=(string)metadata["driverName"],port=(string)metadata["portName"],document=(string)metadata["documentName"];int remaining=Convert.ToInt32(metadata["size"]);if(remaining<=0||remaining>32*1024*1024||!document.StartsWith("BASHKAR-"))throw new Exception();bool found=false;
  foreach(var p in Printers())if((string)p["queueName"]==queue&&(string)p["driverName"]==driver&&(string)p["portName"]==port&&port.StartsWith("USB",StringComparison.OrdinalIgnoreCase))found=true;
  if(!found||!OpenPrinter(queue,out handle,IntPtr.Zero)){Emit(new {state="FAILED_SAFE",stage="OPEN_PRINTER",code=Marshal.GetLastWin32Error()});return 1;}
  // Once this call can start, lack of a terminal result is UNKNOWN, even with 0
  // acknowledged bytes: the spooler may continue independently of this process.
  started=true;job=StartDocPrinter(handle,1,new DOCINFO{pDocName=document});if(job==0)throw new Exception();Emit(new {stage="START_DOC",osJobId=job});if(!StartPagePrinter(handle))throw new Exception();
  while(remaining>0){byte[] bytes=reader.ReadBytes(Math.Min(65536,remaining));if(bytes.Length==0)throw new Exception();int offset=0;while(offset<bytes.Length){byte[] part=offset==0?bytes:new ArraySegment<byte>(bytes,offset,bytes.Length-offset).ToArray();int written;bool ok=WritePrinter(handle,part,part.Length,out written);total+=written;offset+=written;if(!ok||written<=0)throw new Exception();}remaining-=bytes.Length;}
  if(!EndPagePrinter(handle)||!EndDocPrinter(handle))throw new Exception();Emit(new {state="SENT",stage="END_DOC",osJobId=job,written=total});return 0;
 }catch{Emit(new {state=started?"UNKNOWN":"FAILED_SAFE",stage=started?"AFTER_START_DOC":"BEFORE_START_DOC",osJobId=job,written=total,code=Marshal.GetLastWin32Error()});return 1;}finally{if(handle!=IntPtr.Zero)ClosePrinter(handle);}}
}
